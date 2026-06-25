import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Sandbox as JustBashSandbox, type SandboxOptions as JustBashOptions } from "just-bash"
import type { SandboxAgent } from "sandbox-agent"
import {
  createSandboxFs as createAgentOsSandboxFs,
  createSandboxToolkit as createAgentOsSandboxToolkit,
} from "@rivet-dev/agent-os-sandbox"
import { Daytona, type Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import type { Sandbox as VercelSandbox } from "@vercel/sandbox"

import type { CommandResult } from "./commands.js"
import type {
  SandboxConfig,
  SandboxProvider,
  SandboxProviderObject,
} from "./types.js"
import {
  buildDeclarativeImage,
  getDaytonaConfig,
  resolveDaytonaLanguage,
  resolveDaytonaVolumes,
} from "./providers/daytona.js"
import {
  provisionSpritesSandbox,
  spritesExec,
} from "./providers/sprites.js"
import type { SpritesSandbox } from "./providers/types.js"
import { provisionVercelSandbox } from "./providers/vercel.js"

export type SandboxExecInput = {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
}

export type SandboxFileInput = {
  path: string
  content: string | Uint8Array | Buffer
  encoding?: "utf-8" | "base64"
}

export type SandboxSessionCheckpoint = {
  checkpointId: string
}

export type SandboxProviderCreateOptions = {
  sandboxId?: string
  workspaceRoot?: string
}

export type SandboxSessionProvider = SandboxProviderObject & {
  createSession(options?: SandboxProviderCreateOptions): Promise<SandboxSession>
}

export type SandboxSession = {
  id: string
  provider: SandboxProvider
  workspaceRoot: string
  handle: unknown
  exec(input: SandboxExecInput): Promise<CommandResult>
  writeFile(file: SandboxFileInput): Promise<void>
  writeFiles(files: SandboxFileInput[]): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  stop(): Promise<void>
  getPortUrl?(port: number): Promise<string>
  checkpoint?(comment?: string): Promise<SandboxSessionCheckpoint>
}

export type LocalSandboxOptions = {
  basePath?: string
  env?: Record<string, string>
  cleanup?: boolean
}

function normalizeWorkspaceRoot(value: string | undefined, fallback = "/workspace") {
  const root = String(value ?? "").trim() || fallback
  return root.replace(/\/+$/, "") || "/"
}

function normalizeLocalWorkspaceRoot(value: string | undefined) {
  return String(value ?? "").trim() || join(tmpdir(), `ekairos-sandbox-local-${randomUUID()}`)
}

function normalizeArgs(args: string[] | undefined) {
  return Array.isArray(args) ? args.map((arg) => String(arg)) : []
}

function commandText(input: SandboxExecInput) {
  const args = normalizeArgs(input.args)
  return args.length > 0 ? [input.command, ...args].join(" ") : input.command
}

function fileContentAsBase64(file: SandboxFileInput) {
  if (file.encoding === "base64" && typeof file.content === "string") return file.content
  if (typeof file.content === "string") return Buffer.from(file.content, "utf8").toString("base64")
  return Buffer.from(file.content).toString("base64")
}

function fileContentAsText(file: SandboxFileInput) {
  if (file.encoding === "base64" && typeof file.content === "string") {
    return Buffer.from(file.content, "base64").toString("utf8")
  }
  if (typeof file.content === "string") return file.content
  return Buffer.from(file.content).toString("utf8")
}

function stripTrailingSlash(value: string) {
  return String(value ?? "").replace(/\/+$/, "")
}

async function streamToBytes(stream: AsyncIterable<string | Buffer | Uint8Array | ArrayBuffer>) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk, "utf8"))
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk))
    } else if (chunk instanceof ArrayBuffer) {
      chunks.push(Buffer.from(chunk))
    } else {
      chunks.push(Buffer.from(chunk))
    }
  }
  return new Uint8Array(Buffer.concat(chunks))
}

function makeCommandResult(params: {
  success?: boolean
  exitCode?: number
  output?: string
  error?: string
  command?: string
}): CommandResult {
  const exitCode = Number(params.exitCode ?? (params.success === false ? 1 : 0))
  return {
    success: params.success ?? exitCode === 0,
    exitCode,
    output: params.output ?? "",
    error: params.error ?? "",
    command: params.command,
  }
}

function shellEscapeArg(value: string): string {
  if (value.length === 0) return "''"
  if (/^[a-zA-Z0-9_./:-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

async function runLocalCommand(
  input: SandboxExecInput,
  defaults: { cwd: string; env?: Record<string, string> },
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve) => {
    const child = spawn(input.command, normalizeArgs(input.args), {
      cwd: input.cwd ?? defaults.cwd,
      env: {
        ...process.env,
        ...(defaults.env ?? {}),
        ...(input.env ?? {}),
      },
      windowsHide: true,
      signal: input.signal,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    let timeout: NodeJS.Timeout | undefined

    function finish(result: CommandResult) {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      resolve(result)
    }

    if (input.timeoutMs && input.timeoutMs > 0) {
      timeout = setTimeout(() => {
        child.kill()
        finish(makeCommandResult({
          success: false,
          exitCode: 124,
          output: Buffer.concat(stdout).toString("utf8"),
          error: Buffer.concat(stderr).toString("utf8") || "Command timed out",
          command: commandText(input),
        }))
      }, input.timeoutMs)
    }

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)))
    child.on("error", (error) => {
      finish(makeCommandResult({
        success: false,
        exitCode: 1,
        output: Buffer.concat(stdout).toString("utf8"),
        error: error instanceof Error ? error.message : String(error),
        command: commandText(input),
      }))
    })
    child.on("close", (code) => {
      finish(makeCommandResult({
        exitCode: Number(code ?? 0),
        output: Buffer.concat(stdout).toString("utf8"),
        error: Buffer.concat(stderr).toString("utf8"),
        command: commandText(input),
      }))
    })
  })
}

export async function createSandboxSession(
  provider: SandboxSessionProvider,
  options?: SandboxProviderCreateOptions,
): Promise<SandboxSession> {
  return await provider.createSession(options)
}

export function localSandbox(options: LocalSandboxOptions = {}): SandboxSessionProvider {
  return {
    kind: "local",
    async createSession(createOptions) {
      const generatedRoot = !createOptions?.workspaceRoot && !options.basePath
      const workspaceRoot = normalizeLocalWorkspaceRoot(createOptions?.workspaceRoot ?? options.basePath)
      await mkdir(workspaceRoot, { recursive: true })

      return {
        id: createOptions?.sandboxId ?? `local:${randomUUID()}`,
        provider: "local",
        workspaceRoot,
        handle: { workspaceRoot },
        async exec(input) {
          return await runLocalCommand(input, {
            cwd: workspaceRoot,
            env: options.env,
          })
        },
        async writeFile(file) {
          await mkdir(dirname(file.path), { recursive: true })
          await writeFile(file.path, Buffer.from(fileContentAsBase64(file), "base64"))
        },
        async writeFiles(files) {
          for (const file of files) {
            await mkdir(dirname(file.path), { recursive: true })
            await writeFile(file.path, Buffer.from(fileContentAsBase64(file), "base64"))
          }
        },
        async readFile(path) {
          return new Uint8Array(await readFile(path))
        },
        async stop() {
          if (options.cleanup || generatedRoot) {
            await rm(workspaceRoot, { recursive: true, force: true })
          }
        },
      }
    },
  }
}

export function justBashSandbox(options?: JustBashOptions): SandboxSessionProvider {
  return {
    kind: "justbash",
    async createSession(createOptions) {
      const workspaceRoot = normalizeWorkspaceRoot(createOptions?.workspaceRoot ?? options?.cwd)
      const sandbox = await JustBashSandbox.create({
        ...options,
        cwd: workspaceRoot,
      })
      await sandbox.mkDir(workspaceRoot, { recursive: true })

      return {
        id: createOptions?.sandboxId ?? `justbash:${randomUUID()}`,
        provider: "justbash",
        workspaceRoot,
        handle: sandbox,
        async exec(input) {
          const result = await sandbox.runCommand({
            cmd: input.command,
            args: normalizeArgs(input.args),
            cwd: input.cwd,
            env: input.env,
            signal: input.signal,
          })
          return makeCommandResult({
            exitCode: result.exitCode,
            output: await result.stdout(),
            error: await result.stderr(),
            command: commandText(input),
          })
        },
        async writeFile(file) {
          await sandbox.writeFiles({
            [file.path]: {
              content: fileContentAsBase64(file),
              encoding: "base64",
            },
          })
        },
        async writeFiles(files) {
          const input: Record<string, { content: string; encoding: "base64" }> = {}
          for (const file of files) {
            input[file.path] = {
              content: fileContentAsBase64(file),
              encoding: "base64",
            }
          }
          await sandbox.writeFiles(input)
        },
        async readFile(path) {
          const content = await sandbox.readFile(path, "base64")
          return new Uint8Array(Buffer.from(content, "base64"))
        },
        async stop() {
          await sandbox.stop()
        },
      }
    },
  }
}

export function vercelSandbox(config: SandboxConfig = {}): SandboxSessionProvider {
  return {
    kind: "vercel",
    async createSession(createOptions) {
      const workspaceRoot = normalizeWorkspaceRoot(createOptions?.workspaceRoot, "/vercel/sandbox")
      const sandbox = await provisionVercelSandbox({
        ...config,
        provider: "vercel",
      })
      await sandbox.mkDir(workspaceRoot).catch((error: any) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes("File exists")) throw error
      })

      return {
        id: createOptions?.sandboxId ?? sandbox.name,
        provider: "vercel",
        workspaceRoot,
        handle: sandbox,
        async exec(input) {
          const result = await sandbox.runCommand({
            cmd: input.command,
            args: normalizeArgs(input.args),
            cwd: input.cwd,
            env: input.env,
            signal: input.signal,
          })
          return makeCommandResult({
            exitCode: Number((result as any).exitCode ?? 0),
            output: String((result as any).stdout ?? (result as any).output ?? ""),
            error: String((result as any).stderr ?? (result as any).error ?? ""),
            command: commandText(input),
          })
        },
        async writeFile(file) {
          await sandbox.writeFiles([{ path: file.path, content: Buffer.from(fileContentAsBase64(file), "base64") }])
        },
        async writeFiles(files) {
          await sandbox.writeFiles(
            files.map((file) => ({
              path: file.path,
              content: Buffer.from(fileContentAsBase64(file), "base64"),
            })),
          )
        },
        async readFile(path) {
          const stream = await sandbox.readFile({ path })
          if (!stream) return new Uint8Array()
          return await streamToBytes(stream as AsyncIterable<string | Buffer | Uint8Array | ArrayBuffer>)
        },
        async stop() {
          await sandbox.stop({ blocking: true })
        },
        async getPortUrl(port) {
          return stripTrailingSlash(String((sandbox as VercelSandbox).domain(Math.floor(port))))
        },
      }
    },
  }
}

export function daytonaSandbox(config: SandboxConfig = {}): SandboxSessionProvider {
  return {
    kind: "daytona",
    async createSession(createOptions) {
      const workspaceRoot = normalizeWorkspaceRoot(createOptions?.workspaceRoot, "/home/daytona")
      const daytona = new Daytona(getDaytonaConfig())
      const volumes = await resolveDaytonaVolumes(daytona, config.daytona?.volumes ?? [])
      const declarativeImage = buildDeclarativeImage(config)
      const sandbox = await daytona.create({
        language: resolveDaytonaLanguage(config),
        envVars: config.daytona?.envVars,
        labels: config.daytona?.labels,
        public: config.daytona?.public,
        ephemeral: config.daytona?.ephemeral ?? true,
        user: config.daytona?.user,
        volumes: volumes.length > 0 ? volumes : undefined,
        autoStopInterval: config.daytona?.autoStopIntervalMin,
        autoArchiveInterval: config.daytona?.autoArchiveIntervalMin,
        ...(declarativeImage || config.daytona?.image
          ? {
              image: declarativeImage ?? config.daytona?.image,
              resources: config.resources?.vcpus ? { cpu: config.resources.vcpus } : undefined,
            }
          : { snapshot: config.daytona?.snapshot }),
      } as any)

      return {
        id: createOptions?.sandboxId ?? sandbox.id,
        provider: "daytona",
        workspaceRoot,
        handle: sandbox,
        async exec(input) {
          const args = normalizeArgs(input.args).map(shellEscapeArg)
          const command = args.length > 0 ? [input.command, ...args].join(" ") : input.command
          const result = await (sandbox as DaytonaSandbox).process.executeCommand(command)
          const exitCode = Number(result.exitCode ?? 0)
          return makeCommandResult({
            exitCode,
            output: String(result.artifacts?.stdout ?? result.result ?? ""),
            error: "",
            command: commandText(input),
          })
        },
        async writeFile(file) {
          await (sandbox as DaytonaSandbox).fs.uploadFiles([
            { source: Buffer.from(fileContentAsBase64(file), "base64"), destination: file.path },
          ])
        },
        async writeFiles(files) {
          await (sandbox as DaytonaSandbox).fs.uploadFiles(
            files.map((file) => ({
              source: Buffer.from(fileContentAsBase64(file), "base64"),
              destination: file.path,
            })),
          )
        },
        async readFile(path) {
          const bytes = await (sandbox as DaytonaSandbox).fs.downloadFile(path)
          return new Uint8Array(Buffer.from(bytes))
        },
        async stop() {
          await daytona.stop(sandbox)
        },
      }
    },
  }
}

export function spritesSandbox(config: SandboxConfig = {}): SandboxSessionProvider {
  return {
    kind: "sprites",
    async createSession(createOptions) {
      const workspaceRoot = normalizeWorkspaceRoot(createOptions?.workspaceRoot)
      const sandbox = await provisionSpritesSandbox({
        sandboxId: createOptions?.sandboxId ?? crypto.randomUUID(),
        config: { ...config, provider: "sprites" },
      })
      return {
        id: createOptions?.sandboxId ?? sandbox.name,
        provider: "sprites",
        workspaceRoot,
        handle: sandbox,
        async exec(input) {
          const result = await spritesExec({
            spriteName: sandbox.name,
            command: input.command,
            args: normalizeArgs(input.args),
          })
          return makeCommandResult({
            exitCode: result.exitCode,
            output: result.stdout,
            error: result.stderr,
            command: commandText(input),
          })
        },
        async writeFile(file) {
          const dirPath = file.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : ""
          const dirCmd = dirPath ? `mkdir -p ${shellEscapeArg(dirPath)} && ` : ""
          const cmd = `${dirCmd}printf %s ${shellEscapeArg(fileContentAsBase64(file))} | base64 -d > ${shellEscapeArg(file.path)}`
          await spritesExec({ spriteName: sandbox.name, command: "sh", args: ["-lc", cmd] })
        },
        async writeFiles(files) {
          for (const file of files) {
            const dirPath = file.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : ""
            const dirCmd = dirPath ? `mkdir -p ${shellEscapeArg(dirPath)} && ` : ""
            const cmd = `${dirCmd}printf %s ${shellEscapeArg(fileContentAsBase64(file))} | base64 -d > ${shellEscapeArg(file.path)}`
            await spritesExec({ spriteName: sandbox.name, command: "sh", args: ["-lc", cmd] })
          }
        },
        async readFile(path) {
          const cmd = `if [ -f ${shellEscapeArg(path)} ]; then base64 ${shellEscapeArg(path)} | tr -d '\\n'; fi`
          const result = await spritesExec({ spriteName: sandbox.name, command: "sh", args: ["-lc", cmd] })
          return new Uint8Array(Buffer.from(String(result.stdout ?? "").trim(), "base64"))
        },
        async stop() {
          if (config.sprites?.deleteOnStop === false) return
          // Sprites lifecycle deletion remains in SandboxService; session stop is best effort.
        },
        async getPortUrl(port) {
          const value = await (sandbox as SpritesSandbox).domain?.(port)
          return stripTrailingSlash(String(value ?? ""))
        },
      }
    },
  }
}

export type AgentOsSandboxClient = Pick<
  SandboxAgent,
  | "runProcess"
  | "writeFsFile"
  | "readFsFile"
  | "mkdirFs"
  | "destroySandbox"
  | "sandboxId"
>

export function agentOsSandbox(options: {
  client: AgentOsSandboxClient
  basePath?: string
}): SandboxSessionProvider {
  return {
    kind: "agentos",
    async createSession(createOptions) {
      const workspaceRoot = normalizeWorkspaceRoot(createOptions?.workspaceRoot ?? options.basePath)
      const client = options.client
      await client.mkdirFs({ path: workspaceRoot }).catch((error: any) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes("already") && !message.includes("exists")) throw error
      })

      return {
        id: createOptions?.sandboxId ?? String(client.sandboxId ?? `agentos:${randomUUID()}`),
        provider: "agentos",
        workspaceRoot,
        handle: client,
        async exec(input) {
          const result = await client.runProcess({
            command: input.command,
            args: normalizeArgs(input.args),
            cwd: input.cwd,
            env: input.env,
            timeoutMs: input.timeoutMs,
          })
          return makeCommandResult({
            exitCode: Number(result.exitCode ?? 0),
            output: String(result.stdout ?? ""),
            error: String(result.stderr ?? ""),
            command: commandText(input),
          })
        },
        async writeFile(file) {
          await client.writeFsFile(
            { path: file.path },
            Buffer.from(fileContentAsBase64(file), "base64"),
          )
        },
        async writeFiles(files) {
          for (const file of files) {
            await client.writeFsFile(
              { path: file.path },
              Buffer.from(fileContentAsBase64(file), "base64"),
            )
          }
        },
        async readFile(path) {
          const bytes = await client.readFsFile({ path })
          return new Uint8Array(Buffer.from(bytes))
        },
        async stop() {
          await client.destroySandbox()
        },
      }
    },
  }
}

export {
  createAgentOsSandboxFs,
  createAgentOsSandboxToolkit,
}

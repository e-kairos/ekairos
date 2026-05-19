import { defineAction } from "@ekairos/domain"
import { z } from "zod"
import type { CommandResult } from "./commands.js"
import type { SandboxConfig } from "./types.js"
import { sandboxSchemaDomain } from "./schema.js"
type ServiceResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string }
type SandboxRuntime = { use: (domain: unknown) => Promise<{ db: unknown }> }
type SandboxRunCommandInput = { sandboxId: string; command: string; args?: string[] }
type SandboxFileInput = { path: string; contentBase64: string }
type SandboxRunCommandProcessInput = SandboxRunCommandInput & {
  cwd?: string
  env?: Record<string, unknown>
  kind?: "command" | "service" | "codex-app-server" | "dev-server" | "test-runner" | "watcher"
  mode?: "foreground" | "background"
  metadata?: Record<string, unknown>
}
type SandboxObservedProcessStartInput = {
  sandboxId: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, unknown>
  kind?: "command" | "service" | "codex-app-server" | "dev-server" | "test-runner" | "watcher"
  mode?: "foreground" | "background"
  externalProcessId?: string
  metadata?: Record<string, unknown>
}
type SandboxObservedProcessAppendInput = {
  processId: string
  type: "stdout" | "stderr" | "status" | "exit" | "error" | "heartbeat" | "metadata"
  data?: Record<string, unknown>
}
type SandboxObservedProcessFinishInput = {
  processId: string
  status?: "exited" | "failed" | "killed" | "lost"
  exitCode?: number
  errorText?: string
  metadata?: Record<string, unknown>
}
type SandboxProcessStreamChunk = {
  type: "stdout" | "stderr" | "status" | "exit" | "error" | "heartbeat" | "metadata"
  data?: Record<string, unknown>
}
type SandboxProcessRunResult = {
  processId: string
  streamId: string
  streamClientId: string
  result?: CommandResult
}
type SandboxAuthInstallInput = {
  sandboxId: string
  codexHome?: string
  authJsonPath?: string
  credentialsJsonPath?: string
  configTomlPath?: string
}
type SandboxCreateEkairosAppInput = {
  sandboxId: string
  appDir: string
  packageManager?: string
  instantTokenEnvName?: string
}

const commandResultSchema: z.ZodType<CommandResult> = z.object({
  success: z.boolean(),
  exitCode: z.number().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  streamingLogs: z.array(z.unknown()).optional(),
  command: z.string().optional(),
}).passthrough() as z.ZodType<CommandResult>

const serviceErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const serviceResultSchema = <Schema extends z.ZodType>(data: Schema) =>
  z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      data,
    }),
    serviceErrorSchema,
  ])

const serviceVoidResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.unknown().optional(),
  }),
  serviceErrorSchema,
])

const sandboxConfigSchema: z.ZodType<SandboxConfig> = z.object({
  provider: z.enum(["vercel", "daytona", "sprites"]).optional(),
  runtime: z.string().optional(),
  timeoutMs: z.number().optional(),
  ports: z.array(z.number()).optional(),
  resources: z.object({ vcpus: z.number().optional() }).passthrough().optional(),
  purpose: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.unknown()).optional(),
  domain: z.unknown().optional(),
  dataset: z.object({ enabled: z.boolean().optional() }).passthrough().optional(),
  skills: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    files: z.array(z.object({
      path: z.string(),
      contentBase64: z.string(),
    })),
  })).optional(),
  vercel: z.record(z.string(), z.unknown()).optional(),
  daytona: z.record(z.string(), z.unknown()).optional(),
  sprites: z.record(z.string(), z.unknown()).optional(),
}).passthrough() as z.ZodType<SandboxConfig>

const sandboxRunCommandInputSchema = z.object({
  sandboxId: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
})

const sandboxRunCommandProcessInputSchema = sandboxRunCommandInputSchema.extend({
  cwd: z.string().optional(),
  env: z.record(z.string(), z.unknown()).optional(),
  kind: z.enum(["command", "service", "codex-app-server", "dev-server", "test-runner", "watcher"]).optional(),
  mode: z.enum(["foreground", "background"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const sandboxObservedProcessStartInputSchema = sandboxRunCommandProcessInputSchema.extend({
  externalProcessId: z.string().optional(),
})

const sandboxObservedProcessAppendInputSchema = z.object({
  processId: z.string(),
  type: z.enum(["stdout", "stderr", "status", "exit", "error", "heartbeat", "metadata"]),
  data: z.record(z.string(), z.unknown()).optional(),
})

const sandboxObservedProcessFinishInputSchema = z.object({
  processId: z.string(),
  status: z.enum(["exited", "failed", "killed", "lost"]).optional(),
  exitCode: z.number().optional(),
  errorText: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const sandboxProcessStreamChunkSchema: z.ZodType<SandboxProcessStreamChunk> = z.object({
  type: z.enum(["stdout", "stderr", "status", "exit", "error", "heartbeat", "metadata"]),
  data: z.record(z.string(), z.unknown()).optional(),
}).passthrough() as z.ZodType<SandboxProcessStreamChunk>

const sandboxProcessRunResultSchema: z.ZodType<SandboxProcessRunResult> = z.object({
  processId: z.string(),
  streamId: z.string(),
  streamClientId: z.string(),
  result: commandResultSchema.optional(),
}).passthrough() as z.ZodType<SandboxProcessRunResult>

const sandboxFileInputSchema = z.object({
  path: z.string(),
  contentBase64: z.string(),
})

const sandboxAuthInstallInputSchema = z.object({
  sandboxId: z.string(),
  codexHome: z.string().optional(),
  authJsonPath: z.string().optional(),
  credentialsJsonPath: z.string().optional(),
  configTomlPath: z.string().optional(),
})

const sandboxCreateEkairosAppInputSchema = z.object({
  sandboxId: z.string(),
  appDir: z.string(),
  packageManager: z.string().optional(),
  instantTokenEnvName: z.string().optional(),
})

function shSingleQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`
}

export async function createSandboxExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxConfig
}): Promise<ServiceResult<{ sandboxId: string }>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).createSandbox(input)
}

export async function stopSandboxExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string }
}): Promise<ServiceResult<void>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).stopSandbox(input.sandboxId)
}

export async function runCommandExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxRunCommandInput
}): Promise<ServiceResult<CommandResult>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).runCommand(input.sandboxId, input.command, input.args ?? [])
}

export async function runCommandProcessExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxRunCommandProcessInput
}): Promise<ServiceResult<SandboxProcessRunResult>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).runCommandWithProcessStream(
    input.sandboxId,
    input.command,
    input.args ?? [],
    {
      cwd: input.cwd,
      env: input.env,
      kind: input.kind,
      mode: input.mode,
      metadata: input.metadata,
    },
  )
}

export async function readProcessStreamExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { processId: string }
}): Promise<ServiceResult<{ chunks: SandboxProcessStreamChunk[]; byteOffset: number }>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).readProcessStream(input.processId)
}

export async function startObservedProcessExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxObservedProcessStartInput
}): Promise<ServiceResult<SandboxProcessRunResult>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).startObservedProcess(input.sandboxId, input)
}

export async function appendObservedProcessChunkExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxObservedProcessAppendInput
}): Promise<ServiceResult<void>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).appendObservedProcessChunk(input.processId, input.type, input.data)
}

export async function finishObservedProcessExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxObservedProcessFinishInput
}): Promise<ServiceResult<void>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).finishObservedProcess(input.processId, {
    status: input.status,
    exitCode: input.exitCode,
    errorText: input.errorText,
    metadata: input.metadata,
  })
}

export async function writeFilesExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; files: SandboxFileInput[] }
}): Promise<ServiceResult<void>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).writeFiles(input.sandboxId, input.files)
}

export async function readFileExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; path: string }
}): Promise<ServiceResult<{ contentBase64: string }>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).readFile(input.sandboxId, input.path)
}

export async function installCodexAuthExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxAuthInstallInput
}): Promise<ServiceResult<{ authJson: boolean; credentialsJson: boolean; configToml: boolean }>> {
  "use step"
  const { existsSync, readFileSync } = await import("node:fs")
  const { join } = await import("node:path")
  const { homedir } = await import("node:os")
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  const codexHome = String(input.codexHome ?? "/home/sprite/.codex").trim() || "/home/sprite/.codex"
  const localCodexHome = String(process.env.CODEX_HOME ?? "").trim() || join(homedir(), ".codex")
  const candidates = {
    authJson: String(input.authJsonPath ?? "").trim() || join(localCodexHome, "auth.json"),
    credentialsJson:
      String(input.credentialsJsonPath ?? "").trim() || join(localCodexHome, ".credentials.json"),
    configToml: String(input.configTomlPath ?? "").trim() || join(localCodexHome, "config.toml"),
  }
  const files: SandboxFileInput[] = []
  const copied = { authJson: false, credentialsJson: false, configToml: false }
  if (existsSync(candidates.authJson)) {
    files.push({
      path: `${codexHome}/auth.json`,
      contentBase64: readFileSync(candidates.authJson).toString("base64"),
    })
    copied.authJson = true
  }
  if (existsSync(candidates.credentialsJson)) {
    files.push({
      path: `${codexHome}/.credentials.json`,
      contentBase64: readFileSync(candidates.credentialsJson).toString("base64"),
    })
    copied.credentialsJson = true
  }
  if (existsSync(candidates.configToml)) {
    files.push({
      path: `${codexHome}/config.toml`,
      contentBase64: readFileSync(candidates.configToml).toString("base64"),
    })
    copied.configToml = true
  }
  if (!copied.authJson && !copied.credentialsJson) {
    return { ok: false, error: "codex_auth_file_not_found" }
  }
  const wrote = await new SandboxService(scoped.db as any).writeFiles(input.sandboxId, files)
  if (!wrote.ok) return wrote
  return { ok: true, data: copied }
}

export async function getSandboxExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string }
}): Promise<ServiceResult<Record<string, unknown>>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const result = await (scoped.db as any).query({
    sandbox_sandboxes: { $: { where: { id: input.sandboxId } as any, limit: 1 } },
  })
  const row = result?.sandbox_sandboxes?.[0]
  if (!row) return { ok: false, error: "sandbox_not_found" }
  return { ok: true, data: row }
}

export async function createCheckpointExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; comment?: string }
}): Promise<ServiceResult<{ checkpointId: string }>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).createCheckpoint(input.sandboxId, {
    comment: input.comment,
  })
}

export async function getPortUrlExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; port: number }
}): Promise<ServiceResult<{ url: string }>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  return await new SandboxService(scoped.db as any).getPortUrl(input.sandboxId, input.port)
}

export async function createEkairosAppExecute({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxCreateEkairosAppInput
}): Promise<ServiceResult<SandboxProcessRunResult>> {
  "use step"
  const scoped = await runtime.use(sandboxDomain)
  const { SandboxService } = await import("./service.js")
  const service = new SandboxService(scoped.db as any)
  const appDir = String(input.appDir ?? "").trim() || "/workspace/ekairos-app"
  const tokenEnv = String(input.instantTokenEnvName ?? "INSTANT_PERSONAL_ACCESS_TOKEN").trim()
  const instantToken = String(process.env[tokenEnv] ?? "").trim()
  if (!instantToken) return { ok: false, error: `instant_token_env_missing:${tokenEnv}` }
  const tokenPath = `/tmp/ekairos-instant-token-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const wrote = await service.writeFiles(input.sandboxId, [
    {
      path: tokenPath,
      contentBase64: Buffer.from(instantToken, "utf8").toString("base64"),
    },
  ])
  if (!wrote.ok) return wrote
  const resultPath = `/tmp/ekairos-create-app-${Date.now()}.json`
  const packageManager = String(input.packageManager ?? "pnpm").trim() || "pnpm"
  const command = [
    "set -euo pipefail",
    `TOKEN="$(cat ${shSingleQuote(tokenPath)})"`,
    `rm -f ${shSingleQuote(tokenPath)}`,
    `rm -rf ${shSingleQuote(appDir)}`,
    `npx -y @ekairos/domain@beta create-app ${shSingleQuote(appDir)} --next --no-install --json --package-manager=${shSingleQuote(packageManager)} --instantToken="$TOKEN" > ${shSingleQuote(resultPath)}`,
    `node -e 'const fs=require("fs"); const p=require(${JSON.stringify(`${appDir}/package.json`)}); const r=JSON.parse(fs.readFileSync(${JSON.stringify(resultPath)}, "utf8")); console.log(JSON.stringify({ok:r.ok, provisioned:r.data?.provisioned, appId:r.data?.appId, packageName:p.name, ekairosDomain:p.dependencies?.["@ekairos/domain"], workflow:p.dependencies?.workflow}))'`,
    "echo sandbox_create_ekairos_app_ok",
  ].join("\n")
  return await service.runCommandWithProcessStream(input.sandboxId, "sh", ["-lc", command], {
    kind: "command",
    mode: "foreground",
    metadata: { source: "sandbox.domain", label: "create-ekairos-app" },
  })
}

export const sandboxDomain = sandboxSchemaDomain
  .withActions({
    createSandbox: defineAction({
      name: "sandbox.createSandbox",
      input: sandboxConfigSchema,
      output: serviceResultSchema(z.object({ sandboxId: z.string() })),
      execute: createSandboxExecute,
    }),
    stopSandbox: defineAction({
      name: "sandbox.stopSandbox",
      input: z.object({ sandboxId: z.string() }),
      output: serviceVoidResultSchema,
      execute: stopSandboxExecute,
    }),
    runCommand: defineAction({
      name: "sandbox.runCommand",
      input: sandboxRunCommandInputSchema,
      output: serviceResultSchema(commandResultSchema),
      execute: runCommandExecute,
    }),
    runCommandProcess: defineAction({
      name: "sandbox.runCommandProcess",
      input: sandboxRunCommandProcessInputSchema,
      output: serviceResultSchema(sandboxProcessRunResultSchema),
      execute: runCommandProcessExecute,
    }),
    readProcessStream: defineAction({
      name: "sandbox.readProcessStream",
      input: z.object({ processId: z.string() }),
      output: serviceResultSchema(z.object({
        chunks: z.array(sandboxProcessStreamChunkSchema),
        byteOffset: z.number(),
      })),
      execute: readProcessStreamExecute,
    }),
    startObservedProcess: defineAction({
      name: "sandbox.startObservedProcess",
      input: sandboxObservedProcessStartInputSchema,
      output: serviceResultSchema(sandboxProcessRunResultSchema),
      execute: startObservedProcessExecute,
    }),
    appendObservedProcessChunk: defineAction({
      name: "sandbox.appendObservedProcessChunk",
      input: sandboxObservedProcessAppendInputSchema,
      output: serviceVoidResultSchema,
      execute: appendObservedProcessChunkExecute,
    }),
    finishObservedProcess: defineAction({
      name: "sandbox.finishObservedProcess",
      input: sandboxObservedProcessFinishInputSchema,
      output: serviceVoidResultSchema,
      execute: finishObservedProcessExecute,
    }),
    writeFiles: defineAction({
      name: "sandbox.writeFiles",
      input: z.object({
        sandboxId: z.string(),
        files: z.array(sandboxFileInputSchema),
      }),
      output: serviceVoidResultSchema,
      execute: writeFilesExecute,
    }),
    readFile: defineAction({
      name: "sandbox.readFile",
      input: z.object({
        sandboxId: z.string(),
        path: z.string(),
      }),
      output: serviceResultSchema(z.object({ contentBase64: z.string() })),
      execute: readFileExecute,
    }),
    installCodexAuth: defineAction({
      name: "sandbox.installCodexAuth",
      input: sandboxAuthInstallInputSchema,
      output: serviceResultSchema(z.object({
        authJson: z.boolean(),
        credentialsJson: z.boolean(),
        configToml: z.boolean(),
      })),
      execute: installCodexAuthExecute,
    }),
    getSandbox: defineAction({
      name: "sandbox.getSandbox",
      input: z.object({ sandboxId: z.string() }),
      output: serviceResultSchema(z.record(z.string(), z.unknown())),
      execute: getSandboxExecute,
    }),
    createCheckpoint: defineAction({
      name: "sandbox.createCheckpoint",
      input: z.object({
        sandboxId: z.string(),
        comment: z.string().optional(),
      }),
      output: serviceResultSchema(z.object({ checkpointId: z.string() })),
      execute: createCheckpointExecute,
    }),
    getPortUrl: defineAction({
      name: "sandbox.getPortUrl",
      input: z.object({
        sandboxId: z.string(),
        port: z.number(),
      }),
      output: serviceResultSchema(z.object({ url: z.string() })),
      execute: getPortUrlExecute,
    }),
    createEkairosApp: defineAction({
      name: "sandbox.createEkairosApp",
      input: sandboxCreateEkairosAppInputSchema,
      output: serviceResultSchema(sandboxProcessRunResultSchema),
      execute: createEkairosAppExecute,
    }),
  })

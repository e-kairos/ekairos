import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { CommandResult } from "./commands.js"
import {
  SandboxService,
  type SandboxProcessRunResult,
  type SandboxProcessStreamChunk,
} from "./service.js"
import type { SandboxConfig } from "./types.js"

type ServiceResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string }
type SandboxRuntime = { db: unknown | (() => unknown | Promise<unknown>) }
type SandboxFileInput = { path: string; contentBase64: string }

async function getRuntimeDb(runtime: SandboxRuntime): Promise<any> {
  const candidate = runtime.db
  const db = typeof candidate === "function" ? await candidate.call(runtime) : candidate
  if (!db) throw new Error("sandbox_runtime_db_required")
  return db
}

async function getSandboxService(runtime: SandboxRuntime): Promise<SandboxService> {
  return new SandboxService(await getRuntimeDb(runtime))
}

function shSingleQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`
}

export async function createSandboxStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: SandboxConfig
}): Promise<ServiceResult<{ sandboxId: string }>> {
  "use step"

  return await (await getSandboxService(runtime)).createSandbox(input)
}

export async function stopSandboxStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string }
}): Promise<ServiceResult<void>> {
  "use step"

  return await (await getSandboxService(runtime)).stopSandbox(input.sandboxId)
}

export async function runCommandStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; command: string; args?: string[] }
}): Promise<ServiceResult<CommandResult>> {
  "use step"

  return await (await getSandboxService(runtime)).runCommand(
    input.sandboxId,
    input.command,
    input.args ?? [],
  )
}

export async function runCommandProcessStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: {
    sandboxId: string
    command: string
    args?: string[]
    cwd?: string
    env?: Record<string, unknown>
    kind?: "command" | "service" | "codex-app-server" | "dev-server" | "test-runner" | "watcher"
    mode?: "foreground" | "background"
    metadata?: Record<string, unknown>
  }
}): Promise<ServiceResult<SandboxProcessRunResult>> {
  "use step"

  return await (await getSandboxService(runtime)).runCommandWithProcessStream(
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

export async function readProcessStreamStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { processId: string }
}): Promise<ServiceResult<{ chunks: SandboxProcessStreamChunk[]; byteOffset: number }>> {
  "use step"

  return await (await getSandboxService(runtime)).readProcessStream(input.processId)
}

export async function startObservedProcessStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: {
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
}): Promise<ServiceResult<SandboxProcessRunResult>> {
  "use step"

  return await (await getSandboxService(runtime)).startObservedProcess(input.sandboxId, input)
}

export async function appendObservedProcessChunkStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: {
    processId: string
    type: "stdout" | "stderr" | "status" | "exit" | "error" | "heartbeat" | "metadata"
    data?: Record<string, unknown>
  }
}): Promise<ServiceResult<void>> {
  "use step"

  return await (await getSandboxService(runtime)).appendObservedProcessChunk(
    input.processId,
    input.type,
    input.data,
  )
}

export async function finishObservedProcessStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: {
    processId: string
    status?: "exited" | "failed" | "killed" | "lost"
    exitCode?: number
    errorText?: string
    metadata?: Record<string, unknown>
  }
}): Promise<ServiceResult<void>> {
  "use step"

  return await (await getSandboxService(runtime)).finishObservedProcess(input.processId, {
    status: input.status,
    exitCode: input.exitCode,
    errorText: input.errorText,
    metadata: input.metadata,
  })
}

export async function writeFilesStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; files: SandboxFileInput[] }
}): Promise<ServiceResult<void>> {
  "use step"

  return await (await getSandboxService(runtime)).writeFiles(input.sandboxId, input.files)
}

export async function readFileStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; path: string }
}): Promise<ServiceResult<{ contentBase64: string }>> {
  "use step"

  return await (await getSandboxService(runtime)).readFile(input.sandboxId, input.path)
}

export async function installCodexAuthStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: {
    sandboxId: string
    codexHome?: string
    authJsonPath?: string
    credentialsJsonPath?: string
    configTomlPath?: string
  }
}): Promise<ServiceResult<{ authJson: boolean; credentialsJson: boolean; configToml: boolean }>> {
  "use step"

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

  const wrote = await (await getSandboxService(runtime)).writeFiles(input.sandboxId, files)
  if (!wrote.ok) return wrote
  return { ok: true, data: copied }
}

export async function getSandboxStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string }
}): Promise<ServiceResult<Record<string, unknown>>> {
  "use step"

  const db = await getRuntimeDb(runtime)
  const result = await db.query({
    sandbox_sandboxes: { $: { where: { id: input.sandboxId } as any, limit: 1 } },
  })
  const row = result?.sandbox_sandboxes?.[0]
  if (!row) return { ok: false, error: "sandbox_not_found" }
  return { ok: true, data: row }
}

export async function createCheckpointStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; comment?: string }
}): Promise<ServiceResult<{ checkpointId: string }>> {
  "use step"

  return await (await getSandboxService(runtime)).createCheckpoint(input.sandboxId, {
    comment: input.comment,
  })
}

export async function getPortUrlStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: { sandboxId: string; port: number }
}): Promise<ServiceResult<{ url: string }>> {
  "use step"

  return await (await getSandboxService(runtime)).getPortUrl(input.sandboxId, input.port)
}

export async function createEkairosAppStep({
  runtime,
  input,
}: {
  runtime: SandboxRuntime
  input: {
    sandboxId: string
    appDir: string
    packageManager?: string
    instantTokenEnvName?: string
  }
}): Promise<ServiceResult<SandboxProcessRunResult>> {
  "use step"

  const service = await getSandboxService(runtime)
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

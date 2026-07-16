import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import type { EkairosRuntime } from "@ekairos/domain/runtime"
import type { ContextSandboxHandle } from "@ekairos/events"

import {
  sandboxExecuteCommandInputSchema,
  sandboxExecuteCommandOutputSchema,
  type SandboxExecuteCommandInput,
  type SandboxExecuteCommandOutput,
} from "./contract.js"
import type { CommandResult } from "./commands.js"
import type { SandboxConfig, SandboxProvider } from "./types.js"

type AnyDomainRuntime = EkairosRuntime<Record<string, unknown>, any, any>
type SandboxRuntimeHandle<Runtime extends AnyDomainRuntime> = Runtime & {
  meta?: () => { domain?: unknown }
  use(domain: unknown): Promise<any>
}

export type SerializedSandboxState = {
  version: 1
  sandboxId: string
  provider?: SandboxProvider
  externalSandboxId?: string
  runtime?: string
  ports?: number[]
  purpose?: string
  workspaceRoot?: string
}

export type SerializedSandbox = {
  runtime: SandboxRuntimeHandle<any>
  state: SerializedSandboxState
}

function cleanRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function asNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function asPorts(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ports = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0)
  return ports.length > 0 ? ports : undefined
}

function defaultWorkspaceRoot(provider: SandboxProvider | undefined) {
  return provider === "vercel" ? "/vercel/sandbox" : "/workspace"
}

async function readSandboxState(
  db: any,
  sandboxId: string,
): Promise<SerializedSandboxState> {
  const result = await db.query({
    sandbox_sandboxes: { $: { where: { id: sandboxId } as any, limit: 1 } },
  })
  const row = result?.sandbox_sandboxes?.[0]
  if (!row) throw new Error(`sandbox_not_found:${sandboxId}`)
  const provider = asString(row.provider) as SandboxProvider | undefined
  return cleanRecord({
    version: 1 as const,
    sandboxId,
    provider,
    externalSandboxId: asString(row.externalSandboxId) || undefined,
    runtime: asString(row.runtime) || undefined,
    ports: asPorts(row.ports),
    purpose: asString(row.purpose) || undefined,
    workspaceRoot:
      asString(row?.params?.workspaceRoot).trim() || defaultWorkspaceRoot(provider),
  })
}

async function resolveSandboxDomain(runtime: SandboxRuntimeHandle<any>) {
  const rootDomain = runtime.meta?.().domain
  if (!rootDomain) {
    throw new Error("sandbox_domain_required")
  }
  const scoped = await runtime.use(rootDomain)
  if (!scoped.actions) {
    throw new Error("sandbox_actions_required")
  }
  return scoped
}

function normalizeState(state: SerializedSandboxState): SerializedSandboxState {
  const sandboxId = asString(state.sandboxId).trim()
  if (!sandboxId) {
    throw new Error("Sandbox requires a sandboxId.")
  }
  return cleanRecord({
    version: 1 as const,
    sandboxId,
    provider: state.provider,
    externalSandboxId: asString(state.externalSandboxId).trim() || undefined,
    runtime: asString(state.runtime).trim() || undefined,
    ports: asPorts(state.ports),
    purpose: asString(state.purpose).trim() || undefined,
    workspaceRoot:
      asString(state.workspaceRoot).trim() || defaultWorkspaceRoot(state.provider),
  })
}

export class Sandbox<Runtime extends AnyDomainRuntime = AnyDomainRuntime>
  implements ContextSandboxHandle {
  private readonly runtime: SandboxRuntimeHandle<Runtime>
  private readonly stateValue: SerializedSandboxState

  private constructor(
    runtime: SandboxRuntimeHandle<Runtime>,
    state: SerializedSandboxState,
  ) {
    this.runtime = runtime
    this.stateValue = normalizeState(state)
  }

  static async create<Runtime extends AnyDomainRuntime>(
    runtime: SandboxRuntimeHandle<Runtime>,
    config: SandboxConfig,
  ): Promise<Sandbox<Runtime>> {
    const scoped = await resolveSandboxDomain(runtime)
    const created = await scoped.actions.createSandbox(config)
    if (!created.ok) {
      throw new Error(created.error)
    }
    const state = await readSandboxState(scoped.db, created.data.sandboxId)
    return new Sandbox(runtime, state)
  }

  static async open<Runtime extends AnyDomainRuntime>(
    runtime: SandboxRuntimeHandle<Runtime>,
    sandboxId: string,
  ): Promise<Sandbox<Runtime>> {
    const normalizedId = asString(sandboxId).trim()
    if (!normalizedId) throw new Error("sandbox_id_required")
    const scoped = await resolveSandboxDomain(runtime)
    return new Sandbox(runtime, await readSandboxState(scoped.db, normalizedId))
  }

  static from<Runtime extends AnyDomainRuntime>(
    runtime: SandboxRuntimeHandle<Runtime>,
    state: SerializedSandboxState,
  ): Sandbox<Runtime> {
    return new Sandbox(runtime, state)
  }

  static [WORKFLOW_SERIALIZE](instance: Sandbox<any>): SerializedSandbox {
    return {
      runtime: instance.runtime,
      state: instance.stateValue,
    }
  }

  static [WORKFLOW_DESERIALIZE](data: SerializedSandbox): Sandbox {
    return new Sandbox(data.runtime, data.state)
  }

  get sandboxId() {
    return this.stateValue.sandboxId
  }

  get id() {
    return this.stateValue.sandboxId
  }

  get provider() {
    return this.stateValue.provider ?? "sprites"
  }

  get workspaceRoot() {
    return this.stateValue.workspaceRoot ?? defaultWorkspaceRoot(this.stateValue.provider)
  }

  get state(): SerializedSandboxState {
    return { ...this.stateValue }
  }

  async executeCommand(input: SandboxExecuteCommandInput): Promise<SandboxExecuteCommandOutput> {
    const parsed = sandboxExecuteCommandInputSchema.parse(input)

    const domain = await resolveSandboxDomain(this.runtime)
    const run = await domain.actions.runCommandProcess({
      sandboxId: this.stateValue.sandboxId,
      command: parsed.command,
      args: parsed.args ?? [],
      cwd: parsed.cwd,
      env: parsed.env,
      kind: parsed.kind ?? "command",
      mode: parsed.mode ?? "foreground",
      metadata: {
        source: "sandbox.handle",
        ...(parsed.metadata ?? {}),
      },
    })

    if (!run.ok) {
      return sandboxExecuteCommandOutputSchema.parse({
        sandboxId: this.stateValue.sandboxId,
        success: false,
        error: run.error,
        command:
          parsed.args && parsed.args.length > 0
            ? [parsed.command, ...parsed.args].join(" ")
            : parsed.command,
      })
    }

    const result = (run.data.result ?? {}) as Partial<CommandResult>
    const exitCode = asNumber(result.exitCode)
    return sandboxExecuteCommandOutputSchema.parse(
      cleanRecord({
        sandboxId: this.stateValue.sandboxId,
        processId: run.data.processId,
        streamId: run.data.streamId,
        streamClientId: run.data.streamClientId,
        success: Boolean(result.success ?? (exitCode === undefined || exitCode === 0)),
        exitCode,
        output: asString(result.output) || undefined,
        error: asString(result.error) || undefined,
        command: asString(result.command) || undefined,
        status: exitCode === undefined ? undefined : exitCode === 0 ? "exited" : "failed",
      }),
    )
  }

  async exec(input: {
    command: string
    args?: string[]
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
    signal?: AbortSignal
  }): Promise<SandboxExecuteCommandOutput> {
    return await this.executeCommand({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      env: input.env,
      kind: "command",
      mode: "foreground",
    })
  }

  async writeFile(file: {
    path: string
    content: string | Uint8Array | Buffer
    encoding?: "utf-8" | "base64"
  }): Promise<void> {
    await this.writeFiles([file])
  }

  async writeFiles(files: Array<{
    path: string
    content: string | Uint8Array | Buffer
    encoding?: "utf-8" | "base64"
  }>): Promise<void> {
    const domain = await resolveSandboxDomain(this.runtime)
    const result = await domain.actions.writeFiles({
      sandboxId: this.sandboxId,
      files: files.map(file => ({
        path: file.path,
        contentBase64: file.encoding === "base64" && typeof file.content === "string"
          ? file.content
          : Buffer.from(file.content as any).toString("base64"),
      })),
    })
    if (!result.ok) throw new Error(result.error)
  }

  async readFile(path: string): Promise<Uint8Array> {
    const domain = await resolveSandboxDomain(this.runtime)
    const result = await domain.actions.readFile({
      sandboxId: this.sandboxId,
      path,
    })
    if (!result.ok) throw new Error(result.error)
    return new Uint8Array(Buffer.from(result.data.contentBase64, "base64"))
  }

  async exists(path: string): Promise<boolean> {
    const result = await this.exec({ command: "test", args: ["-e", path] })
    return result.success
  }

  async stop(): Promise<void> {
    const domain = await resolveSandboxDomain(this.runtime)
    const result = await domain.actions.stopSandbox({ sandboxId: this.sandboxId })
    if (!result.ok) throw new Error(result.error)
  }

}

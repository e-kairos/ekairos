import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process"
import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { access, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { createInterface } from "node:readline"

import type {
  CodexActionRequest,
  CodexDynamicTool,
  CodexTurnResult,
} from "./codex.runtime.js"

type JsonRecord = Record<string, unknown>

type PendingRequest = {
  resolve(value: JsonRecord): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

type CodexAppServerIdentity = Readonly<{
  executable: string
  codexHome: string
}>

export type LocalCodexPrepared = CodexAppServerIdentity & Readonly<{
  repoPath: string
  server: LocalCodexAppServer
}>

export type LocalCodexConfig = Readonly<{
  codexPath?: string
  codexHome?: string
  repoPath?: string
}>

export type LocalCodexTurnInput = Readonly<{
  instruction: string
  dynamicTools: readonly CodexDynamicTool[]
  repoPath: string
  model?: string
  state?: CodexTurnResult
  actionResponse?: JsonRecord
}>

let localServerIdentity: CodexAppServerIdentity | undefined
let localServerPromise: Promise<LocalCodexAppServer> | undefined

export async function prepareLocalCodex(
  config: LocalCodexConfig,
): Promise<LocalCodexPrepared> {
  const executable = await resolveCodexExecutable(config.codexPath)
  const codexHome = resolveLocalCodexHome(config.codexHome)
  const identity = Object.freeze({ executable, codexHome })
  if (localServerPromise && (await localServerPromise).isClosed) {
    localServerIdentity = undefined
    localServerPromise = undefined
  }
  const identityKey = JSON.stringify(identity)
  const activeKey = localServerIdentity
    ? JSON.stringify(localServerIdentity)
    : undefined

  if (activeKey && activeKey !== identityKey) {
    throw new Error("codex_engine_local_app_server_config_conflict")
  }
  if (!localServerPromise) {
    localServerIdentity = identity
    localServerPromise = LocalCodexAppServer.start(identity).catch(error => {
      localServerIdentity = undefined
      localServerPromise = undefined
      throw error
    })
  }

  return Object.freeze({
    ...identity,
    repoPath: config.repoPath ?? process.cwd(),
    server: await localServerPromise,
  })
}

export function resolveLocalCodexHome(configured?: string): string {
  return configured || process.env.CODEX_HOME || join(homedir(), ".codex")
}

export async function resolveCodexExecutable(configured?: string): Promise<string> {
  if (configured) return configured
  if (process.platform !== "win32") return "codex"

  const localAppData = process.env.LOCALAPPDATA
  let staleDesktopBin: string | undefined
  if (localAppData) {
    const desktopBin = join(localAppData, "OpenAI", "Codex", "bin")
    staleDesktopBin = desktopBin
    const candidates = await versionedDesktopCodexCandidates(desktopBin)
    if (candidates.length > 0) return candidates[0]!.path
  }

  const fromPath = await findExecutableOnPath(
    "codex.exe",
    staleDesktopBin ? new Set([staleDesktopBin.toLowerCase()]) : new Set(),
  )
  if (fromPath) return fromPath
  throw new Error("codex_engine_local_codex_not_found")
}

async function versionedDesktopCodexCandidates(root: string) {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const candidates = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async entry => {
        const path = join(root, entry.name, "codex.exe")
        try {
          const metadata = await stat(path)
          return metadata.isFile()
            ? { path, modifiedAt: metadata.mtimeMs, directory: entry.name }
            : undefined
        } catch {
          return undefined
        }
      }),
  )

  return candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) =>
      right.modifiedAt - left.modifiedAt ||
      right.directory.localeCompare(left.directory))
}

async function findExecutableOnPath(
  filename: string,
  excludedDirectories: ReadonlySet<string>,
): Promise<string | undefined> {
  for (const directory of String(process.env.PATH ?? "").split(delimiter)) {
    const normalized = directory.trim().replace(/^"|"$/g, "")
    if (!normalized) continue
    if (excludedDirectories.has(normalized.toLowerCase())) continue
    const candidate = join(normalized, filename)
    try {
      await access(candidate)
      return candidate
    } catch {
      // Continue to the next PATH entry.
    }
  }
  return undefined
}

export class LocalCodexAppServer {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly subscribers = new Set<(message: JsonRecord) => void>()
  private readonly reader: ReturnType<typeof createInterface>
  private stderr = ""
  private closed = false

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
  ) {
    this.reader = createInterface({ input: child.stdout })
    this.reader.on("line", line => this.receive(line))
    child.stderr.on("data", chunk => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-16_000)
    })
    child.once("error", error => this.close(error))
    child.once("exit", code => {
      this.close(new Error(
        `codex_app_server_exited:${String(code)}${this.stderr ? `:${this.stderr}` : ""}`,
      ))
    })
  }

  static async start(identity: CodexAppServerIdentity) {
    const child = spawn(identity.executable, ["app-server", "--enable", "apps"], {
      env: {
        ...process.env,
        CODEX_HOME: identity.codexHome,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    child.unref()
    ;(child.stdin as any).unref?.()
    ;(child.stdout as any).unref?.()
    ;(child.stderr as any).unref?.()

    const server = new LocalCodexAppServer(child)
    process.once("exit", () => {
      if (!child.killed) child.kill()
    })
    try {
      await server.request("initialize", {
        clientInfo: { name: "ekairos-codex-engine", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      })
      server.notify("initialized", {})
      return server
    } catch (error) {
      if (!child.killed) child.kill()
      throw error
    }
  }

  get isClosed() {
    return this.closed
  }

  async runTurn(input: LocalCodexTurnInput): Promise<CodexTurnResult> {
    return await runLocalCodexTurn(this, input)
  }

  request(
    method: string,
    params: JsonRecord = {},
    timeoutMs = 60_000,
  ): Promise<JsonRecord> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`codex_app_server_rpc_timeout:${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params: JsonRecord) {
    this.write({ method, params })
  }

  respond(payload: JsonRecord) {
    this.write(payload)
  }

  subscribe(subscriber: (message: JsonRecord) => void) {
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  private write(message: JsonRecord) {
    if (this.closed) throw new Error("codex_app_server_closed")
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private receive(line: string) {
    let message: JsonRecord
    try {
      message = JSON.parse(line) as JsonRecord
    } catch {
      return
    }
    const id = asString(message.id)
    const pending = id ? this.pending.get(id) : undefined
    if (pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      const error = asRecord(message.error)
      if (message.error) {
        pending.reject(new Error(
          asString(error.message) || asString(message.error) || "codex_app_server_rpc_error",
        ))
      } else {
        pending.resolve(message)
      }
      return
    }
    for (const subscriber of this.subscribers) subscriber(message)
  }

  private close(error: Error) {
    if (this.closed) return
    this.closed = true
    this.reader.close()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    const closed = {
      method: "ekairos/app-server/closed",
      params: { message: error.message },
    }
    for (const subscriber of this.subscribers) subscriber(closed)
    this.subscribers.clear()
  }
}

async function runLocalCodexTurn(
  server: LocalCodexAppServer,
  input: LocalCodexTurnInput,
): Promise<CodexTurnResult> {
  let threadId = asString(input.state?.providerContextId)
  let turnId = asString(input.state?.turnId)
  let assistantText = asString(input.state?.assistantText)
  let reasoningText = asString(input.state?.reasoningText)
  let diff = asString(input.state?.diff)
  let usage = asRecord(input.state?.usage)
  let completedTurn: JsonRecord = {}
  let ready = Boolean(threadId && turnId)
  const buffered: JsonRecord[] = []

  return await new Promise<CodexTurnResult>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(
      () => settleError(new Error(`codex_turn_timeout:${turnId || "unknown"}`)),
      300_000,
    )
    const unsubscribe = server.subscribe(message => {
      if (!ready) {
        buffered.push(message)
        return
      }
      handle(message)
    })

    const cleanup = () => {
      clearTimeout(timeout)
      unsubscribe()
    }
    const settle = (result: CodexTurnResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Object.freeze(result))
    }
    const settleError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const handle = (event: JsonRecord) => {
      if (settled) return
      const method = asString(event.method)
      if (method === "ekairos/app-server/closed") {
        settleError(new Error(
          asString(asRecord(event.params).message) || "codex_app_server_closed",
        ))
        return
      }
      if (!method || method.startsWith("codex/event/")) return
      const params = asRecord(event.params)
      const eventTurnId = asString(params.turnId) || asString(asRecord(params.turn).id)
      const eventThreadId =
        asString(params.threadId) ||
        asString(asRecord(params.turn).threadId)
      const scoped = eventTurnId
        ? eventTurnId === turnId
        : eventThreadId
          ? eventThreadId === threadId
          : false
      if (!scoped) return

      if (method === "item/tool/call" && event.id !== undefined && event.id !== null) {
        settle({
          status: "action_required",
          providerContextId: threadId,
          turnId,
          assistantText,
          reasoningText,
          diff,
          usage,
          action: {
            requestId: event.id as string | number,
            ...actionDetails(params),
          },
        })
        return
      }
      if (method === "item/agentMessage/delta") {
        assistantText += asString(params.delta)
      }
      if (
        method === "item/reasoning/summaryTextDelta" ||
        method === "item/reasoning/textDelta"
      ) {
        reasoningText += asString(params.delta)
      }
      if (method === "turn/diff/updated") diff = asString(params.diff)
      if (
        method === "thread/tokenUsage/updated" ||
        method === "context/tokenUsage/updated"
      ) {
        usage = asRecord(params.tokenUsage)
      }
      if (method === "item/completed") {
        const item = asRecord(params.item)
        if (asString(item.type) === "agentMessage" && asString(item.text).trim()) {
          assistantText = asString(item.text)
        }
        if (asString(item.type) === "reasoning" && asString(item.summary).trim()) {
          reasoningText = asString(item.summary)
        }
      }
      if (method === "turn/failed") {
        settleError(new Error(`codex_turn_failed:${eventTurnId || turnId || "unknown"}`))
        return
      }
      if (method === "turn/completed") {
        completedTurn = asRecord(params.turn)
        const status = asString(completedTurn.status).trim().toLowerCase()
        const error = asRecord(completedTurn.error)
        if (status === "failed" || Object.keys(error).length > 0) {
          settleError(new Error(
            asString(error.message) ||
              asString(error.error) ||
              `codex_turn_failed:${eventTurnId || turnId || "unknown"}`,
          ))
          return
        }
        settle({
          status: "completed",
          providerContextId: threadId,
          turnId: asString(completedTurn.id) || turnId,
          assistantText,
          reasoningText,
          diff,
          usage,
          completedTurn,
        })
      }
    }

    void (async () => {
      try {
        if (input.actionResponse) {
          server.respond(input.actionResponse)
        } else {
          const threadParams = codexTurnParams(
            input.repoPath,
            input.model,
            input.dynamicTools,
          )
          const threadStart = await server.request("thread/start", threadParams)
          threadId =
            asString(asRecord(asRecord(threadStart.result).thread).id) ||
            asString(asRecord(threadStart.result).id) ||
            asString(threadStart.threadId)
          if (!threadId) throw new Error("codex_thread_id_missing")

          const turnParams: JsonRecord = {
            ...threadParams,
            threadId,
            input: [{ type: "text", text: input.instruction }],
          }
          const turnStart = await server.request("turn/start", turnParams)
          turnId =
            asString(asRecord(asRecord(turnStart.result).turn).id) ||
            asString(asRecord(turnStart.result).id) ||
            asString(turnStart.turnId)
          if (!turnId) throw new Error("codex_turn_id_missing")
        }
        ready = true
        buffered.splice(0).forEach(handle)
      } catch (error) {
        settleError(error instanceof Error ? error : new Error(String(error)))
      }
    })()
  })
}

function codexTurnParams(
  repoPath: string,
  model: string | undefined,
  dynamicTools: readonly CodexDynamicTool[],
): JsonRecord {
  return {
    cwd: repoPath,
    approvalPolicy: "never",
    sandboxPolicy: {
      type: "externalSandbox",
      networkAccess: "enabled",
    },
    ...(model ? { model } : {}),
    ...(dynamicTools.length > 0
      ? {
          dynamicTools,
          dynamic_tools: dynamicTools,
          experimentalRawEvents: true,
          persistExtendedHistory: true,
        }
      : {}),
  }
}

function actionDetails(params: JsonRecord): Omit<CodexActionRequest, "requestId"> {
  const item = asRecord(params.item)
  const rawInput =
    params.arguments ??
    params.input ??
    params.args ??
    item.arguments ??
    item.input ??
    item.args ??
    {}
  let input = rawInput
  if (typeof rawInput === "string") {
    try {
      input = JSON.parse(rawInput)
    } catch {
      // Keep the raw tool input so the action schema reports the error.
    }
  }
  return {
    callId: asString(
      params.callId ??
      params.toolCallId ??
      params.itemId ??
      item.callId ??
      item.toolCallId ??
      item.id,
    ),
    name: asString(
      params.actionName ??
      params.tool ??
      params.toolName ??
      params.name ??
      item.actionName ??
      item.tool ??
      item.toolName ??
      item.name,
    ),
    input,
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

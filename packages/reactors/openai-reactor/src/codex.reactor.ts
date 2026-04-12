import {
  OUTPUT_ITEM_TYPE,
  createContextStepStreamChunk,
  encodeContextStepStreamChunk,
  type ContextSkillPackage,
  type ContextItem,
  type ContextReactionResult,
  type ContextReactor,
  type ContextReactorParams,
  type ContextStreamChunkType,
} from "@ekairos/events"
import type { ContextEnvironment } from "@ekairos/events/runtime"

import { asRecord, asString, buildCodexParts, defaultInstructionFromTrigger, type AnyRecord } from "./shared.js"

export type CodexConfig = {
  appServerUrl: string
  repoPath: string
  providerContextId?: string
  mode?: "local" | "remote" | "sandbox"
  model?: string
  approvalPolicy?: string
  sandboxPolicy?: Record<string, unknown>
}

export type CodexTurnResult = {
  providerContextId: string
  turnId: string
  assistantText: string
  reasoningText?: string
  diff?: string
  toolParts?: unknown[]
  metadata?: Record<string, unknown>
  usage?: Record<string, unknown>
}

export type CodexExecuteTurnArgs<
  Context,
  Config extends CodexConfig = CodexConfig,
  Env extends ContextEnvironment = ContextEnvironment,
> = {
  env: Env
  context: AnyRecord
  triggerEvent: ContextItem
  contextId: string
  eventId: string
  executionId: string
  stepId: string
  iteration: number
  instruction: string
  config: Config
  skills: ContextSkillPackage[]
  contextStepStream?: WritableStream<string>
  writable?: WritableStream<unknown>
  silent: boolean
  emitChunk: (providerChunk: unknown) => Promise<void>
}

export type CodexAppServerTurnStepArgs<
  Config extends CodexConfig = CodexConfig,
> = {
  config: Config
  instruction: string
  contextId: string
  eventId: string
  executionId: string
  stepId: string
  contextStepStream?: WritableStream<string>
  writable?: WritableStream<unknown>
  silent: boolean
}

export type CodexChunkMappingResult = {
  chunkType: ContextStreamChunkType
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
  skip?: boolean
}

export type CodexMappedChunk = {
  at: string
  sequence: number
  chunkType: ContextStreamChunkType
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
}

const PROVIDER_SCOPE_PREFIX = "context/"
const PROVIDER_STARTED = "context/started"
const PROVIDER_ARCHIVED = "context/archived"
const PROVIDER_UNARCHIVED = "context/unarchived"
const PROVIDER_NAME_UPDATED = "context/name/updated"
const PROVIDER_USAGE_UPDATED = "context/tokenUsage/updated"

export type CodexStreamTrace = {
  totalChunks: number
  chunkTypes: Record<string, number>
  providerChunkTypes: Record<string, number>
  chunks?: CodexMappedChunk[]
}

type CodexEmitPayload = {
  at: string
  sequence: number
  chunkType: ContextStreamChunkType
  provider: "codex"
  providerChunkType?: string
  actionRef?: string
  data?: unknown
  raw?: unknown
}

export type CreateCodexReactorOptions<
  Context,
  Config extends CodexConfig = CodexConfig,
  Env extends ContextEnvironment = ContextEnvironment,
> = {
  toolName?: string
  includeReasoningPart?: boolean
  buildInstruction?: (params: {
    env: Env
    context: AnyRecord
    triggerEvent: ContextItem
  }) => string | Promise<string>
  resolveConfig: (params: {
    env: Env
    context: AnyRecord
    triggerEvent: ContextItem
    contextId: string
    eventId: string
    executionId: string
    stepId: string
    iteration: number
  }) => Promise<Config>
  executeTurn?: (
    args: CodexExecuteTurnArgs<Context, Config, Env>,
  ) => Promise<CodexTurnResult>
  mapChunk?: (providerChunk: unknown) => CodexChunkMappingResult | null
  includeStreamTraceInOutput?: boolean
  includeRawProviderChunksInOutput?: boolean
  maxPersistedStreamChunks?: number
  onMappedChunk?: (
    chunk: CodexMappedChunk,
    params: ContextReactorParams<Context, Env>,
  ) => Promise<void> | void
}

function toJsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

export function mapCodexChunkType(providerChunkType: string): ContextStreamChunkType {
  const value = providerChunkType.toLowerCase()

  if (value.includes("start_step")) return "chunk.start_step"
  if (value === "start") return "chunk.start"
  if (value.includes("finish_step")) return "chunk.finish_step"
  if (value === "finish") return "chunk.finish"

  if (value.includes("reasoning_start")) return "chunk.reasoning_start"
  if (value.includes("reasoning_delta")) return "chunk.reasoning_delta"
  if (value.includes("reasoning_end")) return "chunk.reasoning_end"

  if (value.includes("action_input_start") || value.includes("tool_input_start")) {
    return "chunk.action_input_start"
  }
  if (value.includes("action_input_delta") || value.includes("tool_input_delta")) {
    return "chunk.action_input_delta"
  }
  if (
    value.includes("action_input_available") ||
    value.includes("tool_input_available") ||
    value.includes("action_call")
  ) {
    return "chunk.action_input_available"
  }
  if (value.includes("action_output_available") || value.includes("tool_output_available")) {
    return "chunk.action_output_available"
  }
  if (value.includes("action_output_error") || value.includes("tool_output_error")) {
    return "chunk.action_output_error"
  }

  if (value.includes("message_metadata")) return "chunk.message_metadata"
  if (value.includes("response_metadata")) return "chunk.response_metadata"

  if (value.includes("text_start")) return "chunk.text_start"
  if (value.includes("text_delta") || (value.includes("message") && value.includes("delta"))) {
    return "chunk.text_delta"
  }
  if (value.includes("text_end")) return "chunk.text_end"

  if (value.includes("source_url")) return "chunk.source_url"
  if (value.includes("source_document")) return "chunk.source_document"
  if (value.includes("file")) return "chunk.file"
  if (value.includes("error")) return "chunk.error"
  return "chunk.unknown"
}

function normalizeLower(value: unknown): string {
  return asString(value).trim().toLowerCase()
}

function isActionItemType(itemType: string): boolean {
  if (!itemType) return false
  if (itemType === "agentmessage") return false
  if (itemType === "reasoning") return false
  if (itemType === "usermessage") return false
  return (
    itemType.includes("commandexecution") ||
    itemType.includes("filechange") ||
    itemType.includes("mcptoolcall") ||
    itemType.includes("tool") ||
    itemType.includes("action")
  )
}

function resolveActionRef(params: AnyRecord, item: AnyRecord): string | undefined {
  const fromParams =
    asString(params.itemId) ||
    asString(params.toolCallId) ||
    asString(params.id)
  if (fromParams) return fromParams
  const fromItem = asString(item.id) || asString(item.toolCallId)
  if (fromItem) return fromItem
  return undefined
}

export function mapCodexAppServerNotification(
  providerChunk: unknown,
): CodexChunkMappingResult | null {
  const chunk = asRecord(providerChunk)
  const method = asString(chunk.method).trim()
  if (!method) return null

  if (method.startsWith("codex/event/")) {
    return {
      chunkType: "chunk.unknown",
      providerChunkType: method,
      data: toJsonSafe({
        ignored: true,
        reason: "legacy_channel_disabled",
        method,
      }),
      raw: toJsonSafe(providerChunk),
      skip: true,
    }
  }

  const params = asRecord(chunk.params)
  const item = asRecord(params.item)
  const itemType = normalizeLower(item.type)
  const itemStatus = normalizeLower(item.status)
  const actionRef = resolveActionRef(params, item)
  const hasItemError = Boolean(item.error)

  const mappedData = toJsonSafe({
    method,
    params,
  })

  const map = (chunkType: ContextStreamChunkType): CodexChunkMappingResult => ({
    chunkType,
    providerChunkType: method,
    actionRef: chunkType.startsWith("chunk.action_") ? actionRef : undefined,
    data: mappedData,
    raw: toJsonSafe(providerChunk),
  })

  switch (method) {
    case "turn/started":
      return map("chunk.start")
    case "turn/completed":
      return map("chunk.finish")
    case "thread/tokenUsage/updated":
      return map("chunk.response_metadata")
    case "thread/status/changed":
    case "thread/started":
      return map("chunk.message_metadata")
    case "turn/diff/updated":
    case "turn/plan/updated":
    case PROVIDER_USAGE_UPDATED:
    case "account/rateLimits/updated":
      return map("chunk.response_metadata")
    case PROVIDER_STARTED:
    case PROVIDER_ARCHIVED:
    case PROVIDER_UNARCHIVED:
    case PROVIDER_NAME_UPDATED:
    case "account/updated":
    case "app/list/updated":
    case "authStatusChange":
    case "sessionConfigured":
    case "loginChatGptComplete":
    case "mcpServer/oauthLogin/completed":
      return map("chunk.message_metadata")
    case "item/agentMessage/delta":
      return map("chunk.text_delta")
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return map("chunk.reasoning_delta")
    case "item/reasoning/summaryPartAdded":
      return map("chunk.reasoning_start")
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/mcpToolCall/progress":
      return map("chunk.action_output_available")
    case "item/started": {
      if (itemType === "agentmessage") return map("chunk.text_start")
      if (itemType === "reasoning") return map("chunk.reasoning_start")
      if (itemType === "usermessage") return map("chunk.message_metadata")
      if (isActionItemType(itemType)) return map("chunk.action_input_available")
      return map("chunk.message_metadata")
    }
    case "item/completed": {
      if (itemType === "agentmessage") return map("chunk.text_end")
      if (itemType === "reasoning") return map("chunk.reasoning_end")
      if (itemType === "usermessage") return map("chunk.message_metadata")
      if (isActionItemType(itemType)) {
        if (hasItemError || itemStatus === "failed" || itemStatus === "declined") {
          return map("chunk.action_output_error")
        }
        return map("chunk.action_output_available")
      }
      if (hasItemError || itemStatus === "failed" || itemStatus === "declined") {
        return map("chunk.error")
      }
      return map("chunk.message_metadata")
    }
    case "error":
      return map("chunk.error")
    default:
      if (method.startsWith("item/") || method.startsWith("turn/")) {
        return map("chunk.response_metadata")
      }
      if (method.startsWith(PROVIDER_SCOPE_PREFIX) || method.startsWith("account/")) {
        return map("chunk.message_metadata")
      }
      return map("chunk.unknown")
  }
}

export function defaultMapCodexChunk(providerChunk: unknown): CodexChunkMappingResult {
  const appServerMapped = mapCodexAppServerNotification(providerChunk)
  if (appServerMapped) {
    return appServerMapped
  }

  const chunk = asRecord(providerChunk)
  const providerChunkType = asString(chunk.type) || "unknown"
  const actionRef = asString(chunk.actionRef) || asString(chunk.toolCallId) || asString(chunk.id) || undefined

  return {
    chunkType: mapCodexChunkType(providerChunkType),
    providerChunkType,
    actionRef,
    data: toJsonSafe({
      id: chunk.id,
      delta: chunk.delta,
      text: chunk.text,
      finishReason: chunk.finishReason,
      actionName: chunk.actionName,
      toolName: chunk.toolName,
      toolCallId: chunk.toolCallId,
    }),
    raw: toJsonSafe(providerChunk),
  }
}

function asFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  return n
}

function getNestedRecord(source: unknown, key: string): AnyRecord | undefined {
  const record = asRecord(source)
  const nested = record[key]
  if (!nested || typeof nested !== "object") return undefined
  return asRecord(nested)
}

function extractUsageMetrics(usageSource: unknown) {
  const usage = asRecord(usageSource)
  const promptTokens =
    asFiniteNumber(usage.promptTokens) ??
    asFiniteNumber(usage.prompt_tokens) ??
    asFiniteNumber(usage.inputTokens) ??
    asFiniteNumber(usage.input_tokens) ??
    0

  const completionTokens =
    asFiniteNumber(usage.completionTokens) ??
    asFiniteNumber(usage.completion_tokens) ??
    asFiniteNumber(usage.outputTokens) ??
    asFiniteNumber(usage.output_tokens) ??
    0

  const totalTokens =
    asFiniteNumber(usage.totalTokens) ??
    asFiniteNumber(usage.total_tokens) ??
    promptTokens + completionTokens

  const promptDetails = getNestedRecord(usage, "prompt_tokens_details")
  const inputDetails = getNestedRecord(usage, "input_tokens_details")
  const cachedPromptTokens =
    asFiniteNumber(usage.promptTokensCached) ??
    asFiniteNumber(usage.cached_prompt_tokens) ??
    asFiniteNumber(promptDetails?.cached_tokens) ??
    asFiniteNumber(inputDetails?.cached_tokens) ??
    0

  const promptTokensUncached = Math.max(0, promptTokens - cachedPromptTokens)

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    promptTokensCached: cachedPromptTokens,
    promptTokensUncached,
  }
}

function asUnknownArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asNumberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value)
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      out[key] = entry
    }
  }
  return out
}

function isValidProviderContextId(value: string): boolean {
  const normalized = value.trim()
  if (!normalized) return false
  if (/^[0-9a-fA-F-]{36}$/.test(normalized)) return true
  if (/^urn:uuid:[0-9a-fA-F-]{36}$/.test(normalized)) return true
  return false
}

function normalizeAppServerBaseUrl(raw: string): string {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "")
  if (trimmed.endsWith("/turn")) return trimmed.slice(0, -"/turn".length)
  if (trimmed.endsWith("/rpc")) return trimmed.slice(0, -"/rpc".length)
  if (trimmed.endsWith("/events")) return trimmed.slice(0, -"/events".length)
  return trimmed
}

function parseSseDataBlock(block: string): string | null {
  const lines = block.split("\n").map((line) => line.trimEnd())
  const dataLines = lines.filter((line) => line.startsWith("data:"))
  if (!dataLines.length) return null
  return dataLines.map((line) => line.replace(/^data:\s*/, "")).join("\n")
}

async function readJsonResponse(response: Response): Promise<AnyRecord> {
  const text = await response.text().catch(() => "")
  if (!text.trim()) return {}
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return {}
  }
}

async function codexAppServerRpc<T = AnyRecord>(
  baseUrl: string,
  method: string,
  params: AnyRecord,
): Promise<T> {
  const response = await fetch(`${baseUrl}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok) {
    const error = asString(payload.error) || asString(asRecord(payload.error).message)
    throw new Error(error || `codex_rpc_http_${response.status}`)
  }
  if (payload.error) {
    const error = asString(payload.error) || asString(asRecord(payload.error).message)
    throw new Error(error || "codex_rpc_error")
  }
  return payload as T
}

export async function executeCodexAppServerTurnStep<
  Config extends CodexConfig = CodexConfig,
>(args: CodexAppServerTurnStepArgs<Config>): Promise<CodexTurnResult> {
  "use step"

  const baseUrl = normalizeAppServerBaseUrl(args.config.appServerUrl)
  if (!baseUrl) throw new Error("codex_app_server_url_required")

  let sequence = 0
  const mappedChunks: CodexMappedChunk[] = []
  const chunkTypeCounters = new Map<string, number>()
  const providerChunkTypeCounters = new Map<string, number>()
  const contextWriter = args.contextStepStream?.getWriter()
  const workflowWriter = args.writable?.getWriter()

  const emitProviderChunk = async (providerChunk: unknown) => {
    const mapped = defaultMapCodexChunk(providerChunk)
    if (!mapped || mapped.skip) return

    sequence += 1
    const mappedChunk: CodexMappedChunk = {
      at: new Date().toISOString(),
      sequence,
      chunkType: mapped.chunkType,
      providerChunkType: mapped.providerChunkType,
      actionRef: mapped.actionRef,
      data: mapped.data,
      raw: mapped.raw ?? toJsonSafe(providerChunk),
    }
    mappedChunks.push(mappedChunk)
    chunkTypeCounters.set(
      mappedChunk.chunkType,
      (chunkTypeCounters.get(mappedChunk.chunkType) ?? 0) + 1,
    )
    const providerType = mappedChunk.providerChunkType || "unknown"
    providerChunkTypeCounters.set(
      providerType,
      (providerChunkTypeCounters.get(providerType) ?? 0) + 1,
    )

    const payload: CodexEmitPayload = {
      at: mappedChunk.at,
      sequence,
      chunkType: mappedChunk.chunkType,
      provider: "codex",
      providerChunkType: mappedChunk.providerChunkType,
      actionRef: mappedChunk.actionRef,
      data: mappedChunk.data,
      raw: mappedChunk.raw,
    }

    await contextWriter?.write(
      encodeContextStepStreamChunk(createContextStepStreamChunk(payload)),
    )
    await workflowWriter?.write({
      type: "data-chunk.emitted",
      data: {
        type: "chunk.emitted",
        contextId: args.contextId,
        executionId: args.executionId,
        stepId: args.stepId,
        itemId: args.eventId,
        ...payload,
      },
    } as any)
  }

  const streamTrace = () => ({
    totalChunks: mappedChunks.length,
    chunkTypes: Object.fromEntries(chunkTypeCounters.entries()),
    providerChunkTypes: Object.fromEntries(providerChunkTypeCounters.entries()),
    chunks: mappedChunks,
  })

  try {
    if (String(args.config.appServerUrl || "").trim().replace(/\/+$/, "").endsWith("/turn")) {
      const response = await fetch(args.config.appServerUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction: args.instruction,
          config: args.config,
          runtime: { source: "openai-reactor" },
        }),
      })
      const payload = await readJsonResponse(response)
      if (!response.ok) {
        throw new Error(asString(payload.error) || `codex_turn_http_${response.status}`)
      }
      for (const chunk of asUnknownArray(payload.stream)) {
        await emitProviderChunk(chunk)
      }
      return {
        providerContextId:
          asString(payload.providerContextId) ||
          asString(payload.contextId) ||
          asString(args.config.providerContextId),
        turnId: asString(payload.turnId),
        assistantText: asString(payload.assistantText) || asString(payload.text),
        reasoningText: asString(payload.reasoningText) || asString(payload.reasoning),
        diff: asString(payload.diff),
        toolParts: asUnknownArray(payload.toolParts),
        usage: asRecord(payload.usage),
        metadata: {
          provider: "codex-app-server",
          response: payload,
          streamTrace: streamTrace(),
        },
      }
    }

    const eventsResponse = await fetch(`${baseUrl}/events`, {
      method: "GET",
      headers: { accept: "text/event-stream" },
    })
    if (!eventsResponse.ok || !eventsResponse.body) {
      throw new Error(`codex_events_unavailable_${eventsResponse.status}`)
    }

    const requestedThreadId = asString(args.config.providerContextId).trim()
    let providerContextId = requestedThreadId
    if (providerContextId && isValidProviderContextId(providerContextId)) {
      await codexAppServerRpc(baseUrl, "thread/resume", { threadId: providerContextId })
    } else {
      const startParams: AnyRecord = {
        cwd: args.config.repoPath,
        approvalPolicy: args.config.approvalPolicy ?? "never",
        sandboxPolicy:
          args.config.sandboxPolicy && Object.keys(args.config.sandboxPolicy).length > 0
            ? args.config.sandboxPolicy
            : { type: "externalSandbox", networkAccess: "enabled" },
      }
      if (args.config.model) startParams.model = args.config.model
      const started = await codexAppServerRpc(baseUrl, "thread/start", startParams)
      providerContextId =
        asString(asRecord(asRecord(started.result).thread).id) ||
        asString(asRecord(started.result).id) ||
        asString(started.threadId)
    }
    if (!providerContextId) throw new Error("codex_thread_id_missing")

    const turnParams: AnyRecord = {
      threadId: providerContextId,
      input: [{ type: "text", text: args.instruction }],
      cwd: args.config.repoPath,
      approvalPolicy: args.config.approvalPolicy ?? "never",
      sandboxPolicy:
        args.config.sandboxPolicy && Object.keys(args.config.sandboxPolicy).length > 0
          ? args.config.sandboxPolicy
          : { type: "externalSandbox", networkAccess: "enabled" },
    }
    if (args.config.model) turnParams.model = args.config.model
    const turnStart = await codexAppServerRpc(baseUrl, "turn/start", turnParams)
    let turnId =
      asString(asRecord(asRecord(turnStart.result).turn).id) ||
      asString(asRecord(turnStart.result).id) ||
      asString(turnStart.turnId)

    const reader = eventsResponse.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let assistantText = ""
    let reasoningText = ""
    let diff = ""
    let usage: AnyRecord = {}
    let completedTurn: AnyRecord = {}

    try {
      while (true) {
        const read = await reader.read()
        if (read.done) break
        if (!read.value) continue
        buffer += decoder.decode(read.value, { stream: true })
        const blocks = buffer.split("\n\n")
        buffer = blocks.pop() ?? ""
        for (const block of blocks) {
          const data = parseSseDataBlock(block)
          if (!data || data === "[DONE]") continue
          const evt = asRecord(JSON.parse(data))
          const method = asString(evt.method)
          if (!method) continue
          const params = asRecord(evt.params)
          const evtTurnId = asString(params.turnId) || asString(asRecord(params.turn).id)
          const evtThreadId =
            asString(params.threadId) ||
            asString(params.providerContextId) ||
            asString(asRecord(params.turn).threadId) ||
            asString(asRecord(params.turn).providerContextId)
          const scopedToTurn =
            (evtTurnId && turnId && evtTurnId === turnId) ||
            (evtThreadId && evtThreadId === providerContextId) ||
            method.startsWith("thread/") ||
            method.startsWith("context/")
          if (!scopedToTurn) continue

          await emitProviderChunk(evt)

          if (method === "turn/started" && !turnId) {
            turnId = asString(asRecord(params.turn).id) || evtTurnId
          }
          if (method === "item/agentMessage/delta") {
            assistantText += asString(params.delta)
          }
          if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
            reasoningText += asString(params.delta)
          }
          if (method === "turn/diff/updated") {
            diff = asString(params.diff)
          }
          if (method === "thread/tokenUsage/updated" || method === "context/tokenUsage/updated") {
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
          if (method === "turn/completed") {
            completedTurn = asRecord(params.turn)
            return {
              providerContextId,
              turnId: asString(completedTurn.id) || turnId,
              assistantText,
              reasoningText,
              diff,
              toolParts: asUnknownArray(completedTurn.toolParts),
              usage,
              metadata: {
                provider: "codex-app-server",
                providerResponse: completedTurn,
                streamTrace: streamTrace(),
              },
            }
          }
          if (method === "turn/failed") {
            throw new Error(`codex_turn_failed_${evtTurnId || turnId || "unknown"}`)
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
    }

    throw new Error("codex_turn_completion_missing")
  } finally {
    contextWriter?.releaseLock()
    workflowWriter?.releaseLock()
  }
}

/**
 * Codex App Server reactor for @ekairos/events.
 *
 * This maps one Context loop iteration to one Codex turn and returns a persisted
 * assistant event compatible with the Context engine.
 *
 * Workflow compatibility:
 * - `resolveConfig` and `executeTurn` should be implemented with `"use step"`
 *   wrappers when they perform I/O.
 */
export function createCodexReactor<
  Context,
  Config extends CodexConfig = CodexConfig,
  Env extends ContextEnvironment = ContextEnvironment,
>( 
  options: CreateCodexReactorOptions<Context, Config, Env>,
): ContextReactor<Context, Env> {
  const toolName = asString(options.toolName).trim() || "codex"
  const includeReasoningPart = Boolean(options.includeReasoningPart)
  const includeStreamTraceInOutput =
    options.includeStreamTraceInOutput !== undefined
      ? Boolean(options.includeStreamTraceInOutput)
      : true
  const includeRawProviderChunksInOutput = Boolean(options.includeRawProviderChunksInOutput)
  const maxPersistedStreamChunks = Math.max(0, Number(options.maxPersistedStreamChunks ?? 300))

  return async (
    params: ContextReactorParams<Context, Env>,
  ): Promise<ContextReactionResult> => {
    let chunkSequence = 0
    const chunkTypeCounters = new Map<string, number>()
    const providerChunkTypeCounters = new Map<string, number>()
    const capturedChunks: CodexMappedChunk[] = []
    const allCapturedChunks: CodexMappedChunk[] = []
    const semanticChunks: AnyRecord[] = []

    const context = asRecord(params.context.content)
    const instruction = (
      options.buildInstruction
        ? await options.buildInstruction({
            env: params.env,
            context,
            triggerEvent: params.triggerEvent,
          })
        : defaultInstructionFromTrigger(params.triggerEvent)
    ).trim()

    const config = await options.resolveConfig({
      env: params.env,
      context,
      triggerEvent: params.triggerEvent,
      contextId: params.contextId,
      eventId: params.eventId,
      executionId: params.executionId,
      stepId: params.stepId,
      iteration: params.iteration,
    })

    const startedAtMs = Date.now()
    let streamedAssistantText = ""
    let streamedReasoningText = ""
    let streamedDiff = ""
    let streamedProviderContextId = asString(config.providerContextId)
    let streamedTurnId = ""

    function maybeCaptureSemanticChunk(mappedChunk: CodexMappedChunk) {
      const mappedData = asRecord(mappedChunk.data)
      const mappedMethod = asString(mappedData.method)
      if (
        mappedMethod !== "item/started" &&
        mappedMethod !== "item/completed" &&
        mappedMethod !== "thread/tokenUsage/updated" &&
        mappedMethod !== "context/tokenUsage/updated" &&
        mappedMethod !== "turn/completed" &&
        mappedMethod !== "turn/diff/updated"
      ) {
        return
      }
      semanticChunks.push({
        at: mappedChunk.at,
        sequence: mappedChunk.sequence,
        chunkType: mappedChunk.chunkType,
        providerChunkType: mappedChunk.providerChunkType,
        data: mappedChunk.data,
      })
    }

    const persistCompletedReactionParts = async () => {
      if (!params.persistReactionParts) return
      const completedParts = buildCodexParts({
        toolName,
        includeReasoningPart,
        completedOnly: true,
        semanticChunks,
        rawChunks: allCapturedChunks,
        result: {
          providerContextId: streamedProviderContextId,
          turnId: streamedTurnId,
          assistantText: streamedAssistantText,
          reasoningText: streamedReasoningText,
          diff: streamedDiff,
        },
        instruction,
        streamTrace: {
          totalChunks: chunkSequence,
          chunkTypes: Object.fromEntries(chunkTypeCounters.entries()),
          providerChunkTypes: Object.fromEntries(providerChunkTypeCounters.entries()),
          chunks: capturedChunks,
        },
      })
      await params.persistReactionParts(completedParts)
    }

    const emitChunk = async (providerChunk: unknown) => {
      const mapped = options.mapChunk
        ? options.mapChunk(providerChunk)
        : defaultMapCodexChunk(providerChunk)
      if (!mapped || mapped.skip) return
      const now = new Date().toISOString()
      chunkSequence += 1

      const mappedChunk: CodexMappedChunk = {
        at: now,
        sequence: chunkSequence,
        chunkType: mapped.chunkType,
        providerChunkType: mapped.providerChunkType,
        actionRef: mapped.actionRef,
        data: mapped.data,
        raw: includeRawProviderChunksInOutput
          ? mapped.raw ?? toJsonSafe(providerChunk)
          : undefined,
      }
      allCapturedChunks.push({
        ...mappedChunk,
        raw: mapped.raw ?? toJsonSafe(providerChunk),
      })

      chunkTypeCounters.set(
        mapped.chunkType,
        (chunkTypeCounters.get(mapped.chunkType) ?? 0) + 1,
      )
      const providerType = mapped.providerChunkType || "unknown"
      providerChunkTypeCounters.set(
        providerType,
        (providerChunkTypeCounters.get(providerType) ?? 0) + 1,
      )
      if (includeStreamTraceInOutput && capturedChunks.length < maxPersistedStreamChunks) {
        capturedChunks.push(mappedChunk)
      }
      maybeCaptureSemanticChunk(mappedChunk)

      const mappedData = asRecord(mappedChunk.data)
      const mappedParams = asRecord(mappedData.params)
      const mappedItem = asRecord(mappedParams.item)
      const mappedTurn = asRecord(mappedParams.turn)
      streamedProviderContextId =
        asString(
          mappedParams.threadId ||
            mappedParams.providerContextId ||
            mappedTurn.threadId ||
            mappedTurn.providerContextId,
        ) || streamedProviderContextId
      streamedTurnId =
        asString(mappedParams.turnId || mappedTurn.id) || streamedTurnId

      const mappedMethod = asString(mappedData.method)
      if (mappedMethod === "item/agentMessage/delta") {
        streamedAssistantText += asString(mappedParams.delta)
      }
      if (
        mappedMethod === "item/reasoning/summaryTextDelta" ||
        mappedMethod === "item/reasoning/textDelta"
      ) {
        streamedReasoningText += asString(mappedParams.delta)
      }
      if (mappedMethod === "turn/diff/updated") {
        streamedDiff = asString(mappedParams.diff)
      }
      if (mappedMethod === "item/completed" && asString(mappedItem.type) === "agentMessage") {
        streamedAssistantText = asString(mappedItem.text || streamedAssistantText)
      }
      if (mappedMethod === "item/completed" && asString(mappedItem.type) === "reasoning") {
        streamedReasoningText = asString(mappedItem.summary || streamedReasoningText)
      }

      if (options.onMappedChunk) {
        try {
          await options.onMappedChunk(mappedChunk, params)
        } catch {
          // hooks are non-critical
        }
      }

      if (mappedMethod === "item/completed" || mappedMethod === "turn/completed") {
        await persistCompletedReactionParts()
      }

      const payload: CodexEmitPayload = {
        at: now,
        sequence: mappedChunk.sequence,
        chunkType: mappedChunk.chunkType,
        provider: "codex",
        providerChunkType: mappedChunk.providerChunkType,
        actionRef: mappedChunk.actionRef,
        data: mappedChunk.data,
        raw: mapped.raw ?? toJsonSafe(providerChunk),
      }

      if (params.contextStepStream) {
        const writer = params.contextStepStream.getWriter()
        try {
          await writer.write(
            encodeContextStepStreamChunk(
              createContextStepStreamChunk(payload),
            ),
          )
        } finally {
          writer.releaseLock()
        }
      }

      if (params.writable) {
        const writer = params.writable.getWriter()
        try {
          await writer.write({
            type: "data-chunk.emitted",
            data: {
              type: "chunk.emitted",
              contextId: params.contextId,
              executionId: params.executionId,
              stepId: params.stepId,
              itemId: params.eventId,
              ...payload,
            },
          })
        } finally {
          writer.releaseLock()
        }
      }
    }

    const turn = options.executeTurn
      ? await options.executeTurn({
        env: params.env,
        context,
        triggerEvent: params.triggerEvent,
        contextId: params.contextId,
        eventId: params.eventId,
        executionId: params.executionId,
        stepId: params.stepId,
        iteration: params.iteration,
        instruction,
        config,
        skills: params.skills,
        contextStepStream: params.contextStepStream,
        writable: params.writable,
        silent: params.silent,
        emitChunk,
      })
      : await executeCodexAppServerTurnStep({
          config,
          instruction,
          contextId: params.contextId,
          eventId: params.eventId,
          executionId: params.executionId,
          stepId: params.stepId,
          contextStepStream: params.contextStepStream,
          writable: params.writable as WritableStream<unknown> | undefined,
          silent: params.silent,
        })
    const finishedAtMs = Date.now()
    const returnedStreamTrace = asRecord(asRecord(turn.metadata).streamTrace)
    const returnedChunks = Array.isArray(returnedStreamTrace.chunks)
      ? (returnedStreamTrace.chunks as CodexMappedChunk[])
      : []
    const effectiveRawChunks = allCapturedChunks.length > 0 ? allCapturedChunks : returnedChunks
    const effectiveSemanticChunks = semanticChunks.length > 0 ? semanticChunks : returnedChunks
    const returnedChunkTypes = asNumberRecord(returnedStreamTrace.chunkTypes)
    const returnedProviderChunkTypes = asNumberRecord(returnedStreamTrace.providerChunkTypes)
    const returnedTotalChunks =
      typeof returnedStreamTrace.totalChunks === "number"
        ? returnedStreamTrace.totalChunks
        : returnedChunks.length

    const streamTrace: CodexStreamTrace | undefined = includeStreamTraceInOutput
      ? {
          totalChunks: chunkSequence || returnedTotalChunks,
          chunkTypes:
            chunkSequence > 0
              ? Object.fromEntries(chunkTypeCounters.entries())
              : returnedChunkTypes,
          providerChunkTypes:
            chunkSequence > 0
              ? Object.fromEntries(providerChunkTypeCounters.entries())
              : returnedProviderChunkTypes,
        }
      : undefined

    const usagePayload = toJsonSafe(turn.usage ?? asRecord(turn.metadata).usage)
    const usageMetrics = extractUsageMetrics(usagePayload)

    const assistantEvent: ContextItem = {
      id: params.eventId,
      type: OUTPUT_ITEM_TYPE,
      channel: "web",
      createdAt: new Date().toISOString(),
      status: "completed",
      content: {
        parts: buildCodexParts({
          toolName,
          includeReasoningPart,
          semanticChunks: effectiveSemanticChunks,
          rawChunks: effectiveRawChunks,
          result: turn,
          instruction,
          streamTrace,
        }),
      },
    }

    return {
      assistantEvent,
      actionRequests: [],
      messagesForModel: [],
      llm: {
        provider: "codex",
        model: asString(config.model || "codex"),
        promptTokens: usageMetrics.promptTokens,
        promptTokensCached: usageMetrics.promptTokensCached,
        promptTokensUncached: usageMetrics.promptTokensUncached,
        completionTokens: usageMetrics.completionTokens,
        totalTokens: usageMetrics.totalTokens,
        latencyMs: Math.max(0, finishedAtMs - startedAtMs),
        rawUsage: usagePayload,
        rawProviderMetadata: toJsonSafe({
          providerContextId: turn.providerContextId,
          turnId: turn.turnId,
          metadata: turn.metadata ?? null,
          streamTrace: streamTrace
            ? {
                totalChunks: streamTrace.totalChunks,
                chunkTypes: streamTrace.chunkTypes,
                providerChunkTypes: streamTrace.providerChunkTypes,
              }
            : undefined,
        }),
      },
    }
  }
}

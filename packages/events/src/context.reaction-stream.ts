import type { ContextPartEnvelope } from "./context.parts.js"

export const REACTION_STREAM_VERSION = 1 as const

export type ReactionStreamChunkKind =
  | "reaction.started"
  | "reaction.completed"
  | "reaction.failed"
  | "model.round.started"
  | "model.round.completed"
  | "text.delta"
  | "reasoning.delta"
  | "reasoning.completed"
  | "action.input.delta"
  | "action.started"
  | "action.completed"
  | "action.failed"
  | "source.available"
  | "provider.event"
  | "provider.error"

const REACTION_STREAM_KINDS = new Set<ReactionStreamChunkKind>([
  "reaction.started",
  "reaction.completed",
  "reaction.failed",
  "model.round.started",
  "model.round.completed",
  "text.delta",
  "reasoning.delta",
  "reasoning.completed",
  "action.input.delta",
  "action.started",
  "action.completed",
  "action.failed",
  "source.available",
  "provider.event",
  "provider.error",
])

export type ReactionStreamChunk = Readonly<{
  version: typeof REACTION_STREAM_VERSION
  reactionId: string
  eventId?: string
  sequence: number
  at: string
  kind: ReactionStreamChunkKind
  round?: number
  partId?: string
  actionCallId?: string
  actionName?: string
  delta?: string
  input?: unknown
  output?: unknown
  error?: unknown
  data?: unknown
  provider?: string
  providerType?: string
  raw?: unknown
}>

export type ReactionStreamChunkInput = Omit<
  ReactionStreamChunk,
  "version" | "at"
> & Readonly<{ at?: string }>

export type ReactionStreamProjection = Readonly<{
  reactionId: string
  eventId: string
  eventType: string
  channel?: string
  createdAt: string
  status: "running" | "completed" | "failed"
  error?: unknown
  lastSequence: number
  parts: readonly ContextPartEnvelope[]
}>

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`invalid_reaction_stream_${label}`)
  }
}

function assertOptionalString(value: unknown, label: string) {
  if (value !== undefined) assertNonEmptyString(value, label)
}

export function validateReactionStreamChunk(value: unknown): asserts value is ReactionStreamChunk {
  const chunk = record(value)
  if (chunk.version !== REACTION_STREAM_VERSION) {
    throw new Error("invalid_reaction_stream_version")
  }
  assertNonEmptyString(chunk.reactionId, "reactionId")
  assertOptionalString(chunk.eventId, "eventId")
  if (!Number.isSafeInteger(chunk.sequence) || Number(chunk.sequence) < 1) {
    throw new Error("invalid_reaction_stream_sequence")
  }
  assertNonEmptyString(chunk.at, "at")
  if (Number.isNaN(Date.parse(chunk.at))) {
    throw new Error("invalid_reaction_stream_at")
  }
  assertNonEmptyString(chunk.kind, "kind")
  if (!REACTION_STREAM_KINDS.has(chunk.kind as ReactionStreamChunkKind)) {
    throw new Error(`invalid_reaction_stream_kind:${chunk.kind}`)
  }
  if (
    chunk.kind !== "reaction.started" &&
    chunk.kind !== "reaction.completed" &&
    chunk.kind !== "reaction.failed" &&
    typeof chunk.eventId !== "string"
  ) {
    throw new Error(`invalid_reaction_stream_eventId:${chunk.kind}`)
  }
  if (chunk.round !== undefined && (!Number.isSafeInteger(chunk.round) || Number(chunk.round) < 0)) {
    throw new Error("invalid_reaction_stream_round")
  }
  assertOptionalString(chunk.partId, "partId")
  assertOptionalString(chunk.actionCallId, "actionCallId")
  assertOptionalString(chunk.actionName, "actionName")
  assertOptionalString(chunk.provider, "provider")
  assertOptionalString(chunk.providerType, "providerType")
  if (chunk.delta !== undefined && typeof chunk.delta !== "string") {
    throw new Error("invalid_reaction_stream_delta")
  }
  if (
    (chunk.kind === "action.started" ||
      chunk.kind === "action.completed" ||
      chunk.kind === "action.failed" ||
      chunk.kind === "action.input.delta") &&
    typeof chunk.actionCallId !== "string"
  ) {
    throw new Error(`invalid_reaction_stream_actionCallId:${chunk.kind}`)
  }
}

export function createReactionStreamChunk(
  input: ReactionStreamChunkInput,
): ReactionStreamChunk {
  const chunk = Object.freeze({
    ...input,
    version: REACTION_STREAM_VERSION,
    at: input.at ?? new Date().toISOString(),
  })
  validateReactionStreamChunk(chunk)
  return chunk
}

export function parseReactionStreamChunk(value: string | unknown): ReactionStreamChunk {
  const parsed = typeof value === "string" ? JSON.parse(value) : value
  validateReactionStreamChunk(parsed)
  return Object.freeze({ ...parsed })
}

export function encodeReactionStreamChunk(chunk: ReactionStreamChunk): string {
  validateReactionStreamChunk(chunk)
  return `${JSON.stringify(chunk)}\n`
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  )
}

function canonical(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

function parseInputDelta(value: string): unknown {
  if (!value.trim()) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function reduceReactionStream(
  input: readonly ReactionStreamChunk[],
): readonly ReactionStreamProjection[] {
  if (input.length === 0) throw new Error("reaction_stream_empty")
  const chunksBySequence = new Map<number, ReactionStreamChunk>()
  for (const chunk of input) {
    validateReactionStreamChunk(chunk)
    const existing = chunksBySequence.get(chunk.sequence)
    if (existing && canonical(existing) !== canonical(chunk)) {
      throw new Error(`reaction_stream_sequence_conflict:${chunk.sequence}`)
    }
    chunksBySequence.set(chunk.sequence, chunk)
  }
  const chunks = [...chunksBySequence.values()].sort((left, right) => left.sequence - right.sequence)
  const first = chunks[0]!
  for (const chunk of chunks) {
    if (chunk.reactionId !== first.reactionId) {
      throw new Error("reaction_stream_identity_conflict")
    }
  }

  const grouped = new Map<string, ReactionStreamChunk[]>()
  for (const chunk of chunks) {
    if (!chunk.eventId) continue
    grouped.set(chunk.eventId, [...(grouped.get(chunk.eventId) ?? []), chunk])
  }
  return Object.freeze([...grouped.values()].map(reduceReactionEventStream))
}

function reduceReactionEventStream(
  chunks: readonly ReactionStreamChunk[],
): ReactionStreamProjection {
  const first = chunks[0]!
  if (!first.eventId) throw new Error("reaction_stream_event_empty")
  for (const chunk of chunks) {
    if (chunk.reactionId !== first.reactionId || chunk.eventId !== first.eventId) {
      throw new Error("reaction_stream_event_identity_conflict")
    }
  }

  type TextState = { sequence: number; text: string; done?: boolean }
  type ActionState = {
    sequence: number
    terminalSequence?: number
    actionName: string
    inputText: string
    input?: unknown
    output?: unknown
    error?: unknown
    status: "started" | "completed" | "failed"
  }
  const text = new Map<string, TextState>()
  const reasoning = new Map<string, TextState>()
  const actions = new Map<string, ActionState>()
  const sources: Array<{ sequence: number; value: any }> = []
  let status: ReactionStreamProjection["status"] = "running"
  let terminalError: unknown
  let eventType = chunks.some(chunk => chunk.kind.startsWith("action."))
    ? "context.action"
    : "context.model"
  let channel: string | undefined

  for (const chunk of chunks) {
    const data = record(chunk.data)
    if (typeof data.eventType === "string" && data.eventType) eventType = data.eventType
    if (typeof data.channel === "string" && data.channel) channel = data.channel
    if (chunk.kind === "model.round.completed" || chunk.kind === "action.completed") {
      status = "completed"
    }
    if (chunk.kind === "action.failed" || chunk.kind === "provider.error") {
      status = "failed"
      terminalError = chunk.error ?? data.error
    }

    if (chunk.kind === "text.delta" || chunk.kind === "reasoning.delta") {
      const target = chunk.kind === "text.delta" ? text : reasoning
      const key = `${chunk.round ?? 0}:${chunk.partId ?? "default"}`
      const current = target.get(key)
      target.set(key, {
        sequence: current?.sequence ?? chunk.sequence,
        text: `${current?.text ?? ""}${chunk.delta ?? ""}`,
        done: current?.done,
      })
    }
    if (chunk.kind === "reasoning.completed") {
      const key = `${chunk.round ?? 0}:${chunk.partId ?? "default"}`
      const current = reasoning.get(key)
      if (current) reasoning.set(key, { ...current, done: true })
    }

    if (chunk.actionCallId) {
      const current = actions.get(chunk.actionCallId)
      const actionName = chunk.actionName ?? current?.actionName ?? "unknown.action"
      if (chunk.kind === "action.input.delta") {
        const inputText = `${current?.inputText ?? ""}${chunk.delta ?? ""}`
        actions.set(chunk.actionCallId, {
          sequence: current?.sequence ?? chunk.sequence,
          actionName,
          inputText,
          input: parseInputDelta(inputText),
          output: current?.output,
          error: current?.error,
          status: current?.status ?? "started",
          terminalSequence: current?.terminalSequence,
        })
      }
      if (chunk.kind === "action.started") {
        actions.set(chunk.actionCallId, {
          sequence: current?.sequence ?? chunk.sequence,
          actionName,
          inputText: current?.inputText ?? "",
          input: chunk.input ?? current?.input ?? {},
          output: current?.output,
          error: current?.error,
          status: current?.status === "completed" || current?.status === "failed"
            ? current.status
            : "started",
          terminalSequence: current?.terminalSequence,
        })
      }
      if (chunk.kind === "action.completed" || chunk.kind === "action.failed") {
        actions.set(chunk.actionCallId, {
          sequence: current?.sequence ?? chunk.sequence,
          terminalSequence: chunk.sequence,
          actionName,
          inputText: current?.inputText ?? "",
          input: current?.input ?? {},
          output: chunk.output ?? current?.output,
          error: chunk.error ?? current?.error,
          status: chunk.kind === "action.completed" ? "completed" : "failed",
        })
      }
    }

    if (chunk.kind === "source.available") {
      const value = record(chunk.data).source ?? chunk.data
      if (value && typeof value === "object") sources.push({ sequence: chunk.sequence, value })
    }
  }

  const ordered: Array<{ sequence: number; part: ContextPartEnvelope }> = []
  for (const item of reasoning.values()) {
    if (!item.text) continue
    ordered.push({
      sequence: item.sequence,
      part: {
        type: "reasoning",
        content: {
          text: item.text,
          state: status !== "running" || item.done ? "done" : "streaming",
        },
      },
    })
  }
  for (const item of text.values()) {
    if (!item.text) continue
    ordered.push({
      sequence: item.sequence,
      part: { type: "message", content: { text: item.text } },
    })
  }
  for (const [actionCallId, action] of actions) {
    ordered.push({
      sequence: action.sequence,
      part: {
        type: "action",
        content: {
          status: "started",
          actionName: action.actionName,
          actionCallId,
          input: action.input ?? {},
        },
      },
    })
    if (action.status === "completed") {
      ordered.push({
        sequence: action.terminalSequence ?? action.sequence,
        part: {
          type: "action",
          content: {
            status: "completed",
            actionName: action.actionName,
            actionCallId,
            output: action.output,
          },
        },
      })
    }
    if (action.status === "failed") {
      const error = record(action.error)
      ordered.push({
        sequence: action.terminalSequence ?? action.sequence,
        part: {
          type: "action",
          content: {
            status: "failed",
            actionName: action.actionName,
            actionCallId,
            error: {
              message: typeof error.message === "string"
                ? error.message
                : String(action.error ?? "Action failed."),
            },
          },
        },
      })
    }
  }
  if (sources.length > 0) {
    ordered.push({
      sequence: sources[0]!.sequence,
      part: {
        type: "source",
        content: { sources: sources.map(source => source.value) },
      } as ContextPartEnvelope,
    })
  }

  return Object.freeze({
    reactionId: first.reactionId,
    eventId: first.eventId,
    eventType,
    ...(channel ? { channel } : {}),
    createdAt: first.at,
    status,
    ...(terminalError === undefined ? {} : { error: terminalError }),
    lastSequence: chunks[chunks.length - 1]!.sequence,
    parts: Object.freeze(
      ordered
        .sort((left, right) => left.sequence - right.sequence)
        .map(entry => Object.freeze(entry.part)),
    ),
  })
}

function decodeStreamValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(value))
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    )
  }
  return value == null ? "" : String(value)
}

export async function consumeReactionStream(params: {
  db: any
  signal: AbortSignal
  streamId?: string | null
  clientId?: string | null
  byteOffset?: number
  onByteOffset?: (byteOffset: number) => void
  onChunk?: (chunk: ReactionStreamChunk) => void | Promise<void>
  onDone?: () => void | Promise<void>
}): Promise<Readonly<{ byteOffset: number; chunkCount: number }>> {
  const streams = params.db?.streams
  if (!streams?.createReadStream) throw new Error("reaction_streams_unavailable")
  const byteOffset = Math.max(0, params.byteOffset ?? 0)
  const stream = streams.createReadStream({
    ...(params.streamId ? { streamId: params.streamId } : {}),
    ...(params.clientId ? { clientId: params.clientId } : {}),
    byteOffset,
  })
  const reader = stream.getReader()
  const encoder = new TextEncoder()
  let safeOffset = byteOffset
  let receivedOffset = byteOffset
  let buffer = ""
  let chunkCount = 0
  let finished = false
  const abort = () => { void reader.cancel().catch(() => undefined) }
  params.signal.addEventListener("abort", abort, { once: true })

  try {
    while (!params.signal.aborted) {
      const next = await reader.read()
      if (next.done) {
        finished = true
        break
      }
      const value = decodeStreamValue(next.value)
      if (!value) continue
      receivedOffset += encoder.encode(value).length
      buffer += value
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        safeOffset += encoder.encode(`${line}\n`).length
        params.onByteOffset?.(safeOffset)
        if (!trimmed) continue
        await params.onChunk?.(parseReactionStreamChunk(trimmed))
        chunkCount += 1
      }
    }
    if (finished && buffer.trim()) {
      safeOffset += encoder.encode(buffer).length
      params.onByteOffset?.(safeOffset)
      await params.onChunk?.(parseReactionStreamChunk(buffer.trim()))
      chunkCount += 1
    }
    if (finished) await params.onDone?.()
    return Object.freeze({ byteOffset: safeOffset, chunkCount })
  } finally {
    params.signal.removeEventListener("abort", abort)
    if (!finished || receivedOffset !== safeOffset) {
      await reader.cancel().catch(() => undefined)
    }
    try { reader.releaseLock() } catch {}
  }
}

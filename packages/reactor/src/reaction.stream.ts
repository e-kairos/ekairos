import {
  createReactionStreamChunk,
  encodeReactionStreamChunk,
  getContextRuntimeServices,
  type ContextRuntimeServiceHandle,
  type ReactionStreamChunk,
  type ReactionStreamChunkInput,
} from "@ekairos/events"

import type {
  ReactionEngineStream,
  ReactionEngineStreamEmission,
} from "./reactor.js"

const REDACT_KEY = /token|authorization|cookie|secret|api[_-]?key|password/i

function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined || value === null) return value
  if (typeof value === "string") {
    return value.length > 40_000 ? `${value.slice(0, 40_000)}[truncated]` : value
  }
  if (typeof value !== "object") return value
  if (seen.has(value as object)) return "[circular]"
  seen.add(value as object)
  if (Array.isArray(value)) return value.map(item => sanitize(item, seen))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      REDACT_KEY.test(key) ? "[redacted]" : sanitize(item, seen),
    ]),
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export type ReactionStreamController = ReactionEngineStream & Readonly<{
  complete(): Promise<void>
  fail(error: unknown): Promise<void>
}>

export async function openReactionStream(input: {
  runtime: ContextRuntimeServiceHandle
  reactionId: string
}): Promise<ReactionStreamController> {
  const { db, store } = await getContextRuntimeServices(input.runtime)
  const streams = db?.streams
  if (!streams?.createWriteStream) throw new Error("reaction_streams_unavailable")
  const clientId = `context-reaction:${input.reactionId}`
  const writable = streams.createWriteStream({ clientId }) as WritableStream<string> & {
    streamId?: () => Promise<string>
  }
  const streamId = typeof writable.streamId === "function"
    ? await writable.streamId()
    : clientId
  const startedAt = new Date()
  await store.attachReactionStream(input.reactionId, {
    streamId,
    clientId,
    startedAt,
  })
  const writer = writable.getWriter()
  let sequence = Date.now() * 1_000
  let terminal = false

  const emit = async (
    emission: ReactionEngineStreamEmission,
  ): Promise<ReactionStreamChunk> => {
    if (terminal) throw new Error(`reaction_stream_already_finished:${input.reactionId}`)
    sequence += 1
    const full: ReactionStreamChunkInput = {
      ...emission,
      reactionId: input.reactionId,
      sequence,
      ...(emission.input === undefined ? {} : { input: sanitize(emission.input) }),
      ...(emission.output === undefined ? {} : { output: sanitize(emission.output) }),
      ...(emission.error === undefined ? {} : { error: sanitize(emission.error) }),
      ...(emission.data === undefined ? {} : { data: sanitize(emission.data) }),
      ...(emission.raw === undefined ? {} : { raw: sanitize(emission.raw) }),
    }
    const chunk = createReactionStreamChunk(full)
    await writer.write(encodeReactionStreamChunk(chunk))
    return chunk
  }

  const finish = async (error?: unknown) => {
    if (terminal) return
    await emit(error === undefined
      ? { kind: "reaction.completed" }
      : {
          kind: "reaction.failed",
          error: { message: errorMessage(error) },
        })
    terminal = true
    try {
      await writer.close()
    } finally {
      writer.releaseLock()
    }
    await store.finishReactionStream(input.reactionId, {
      finishedAt: new Date(),
      ...(error === undefined ? {} : { error: errorMessage(error) }),
    })
  }

  const controller: ReactionStreamController = Object.freeze({
    reactionId: input.reactionId,
    streamId,
    clientId,
    emit,
    async complete() { await finish() },
    async fail(error: unknown) { await finish(error) },
  })
  await controller.emit({
    kind: "reaction.started",
  })
  return controller
}

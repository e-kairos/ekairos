import { init } from "@instantdb/admin"

import {
  consumeReactionStream,
  type ReactionStreamChunk,
} from "./context.reaction-stream.js"

type EntityName =
  | "context_contexts"
  | "context_sessions"
  | "context_reactions"
  | "context_events"
  | "context_eventParts"
  | "$streams"

export type SessionLogRecord =
  | Readonly<{
      kind: "entity"
      entity: EntityName
      id: string
      value: Record<string, unknown>
    }>
  | Readonly<{
      kind: "stream"
      sessionId: string
      reactionId: string
      streamId: string
      chunk: ReactionStreamChunk
    }>
  | Readonly<{
      kind: "stream.error"
      sessionId: string
      reactionId: string
      streamId: string
      error: string
    }>

export function createSessionLogDb(input: Readonly<{
  appId: string
  adminToken: string
}>) {
  return init({ ...input, useDateObjects: true } as never)
}

function asRows(value: unknown): any[] {
  if (Array.isArray(value)) return value
  return value && typeof value === "object" ? [value] : []
}

function linkIds(value: unknown): string[] {
  return asRows(value)
    .map(row => typeof row?.id === "string" ? row.id : "")
    .filter(Boolean)
}

function entityValue(row: any, relations: readonly string[]) {
  const relationNames = new Set(relations)
  const value = Object.fromEntries(
    Object.entries(row ?? {}).filter(([key]) => !relationNames.has(key)),
  ) as Record<string, unknown>
  const links = Object.fromEntries(
    relations
      .map(name => [name, linkIds(row?.[name])] as const)
      .filter(([, ids]) => ids.length > 0),
  )
  return Object.keys(links).length > 0 ? { ...value, links } : value
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function logSession(input: Readonly<{
  db: any
  sessionId: string
  write(record: SessionLogRecord): void
}>): Promise<void> {
  const seen = new Map<string, string>()
  const readers = new Map<string, AbortController>()
  const startedStreams = new Set<string>()
  let settled = false
  let subscription: { close(): void } | undefined

  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      subscription?.close()
      for (const controller of readers.values()) controller.abort()
      readers.clear()
      error === undefined ? resolve() : reject(error)
    }

    const emitEntity = (
      entity: EntityName,
      row: any,
      relations: readonly string[] = [],
    ) => {
      if (!row || typeof row.id !== "string") return
      const record: SessionLogRecord = Object.freeze({
        kind: "entity",
        entity,
        id: row.id,
        value: entityValue(row, relations),
      })
      const key = `${entity}:${row.id}`
      const serialized = JSON.stringify(record)
      if (seen.get(key) === serialized) return
      seen.set(key, serialized)
      input.write(record)
    }

    const emitEvent = (event: any) => {
      emitEntity("context_events", event, ["eventParts"])
      for (const part of asRows(event?.eventParts)) emitEntity("context_eventParts", part)
    }

    const startStream = (reaction: any, stream: any) => {
      if (!stream?.id || startedStreams.has(stream.id)) return
      const controller = new AbortController()
      startedStreams.add(stream.id)
      readers.set(stream.id, controller)
      void consumeReactionStream({
        db: input.db,
        signal: controller.signal,
        streamId: stream.id,
        onChunk(chunk) {
          input.write(Object.freeze({
            kind: "stream",
            sessionId: input.sessionId,
            reactionId: reaction.id,
            streamId: stream.id,
            chunk,
          }))
          if (chunk.kind === "reaction.completed" || chunk.kind === "reaction.failed") {
            controller.abort()
          }
        },
      }).catch(error => {
        if (controller.signal.aborted) return
        input.write(Object.freeze({
          kind: "stream.error",
          sessionId: input.sessionId,
          reactionId: reaction.id,
          streamId: stream.id,
          error: errorMessage(error),
        }))
      }).finally(() => {
        readers.delete(stream.id)
      })
    }

    const emitReaction = (reaction: any) => {
      emitEntity("context_reactions", reaction, ["parent", "causes", "effects", "stream"])
      for (const event of asRows(reaction?.causes)) emitEvent(event)
      for (const event of asRows(reaction?.effects)) emitEvent(event)
      for (const stream of asRows(reaction?.stream)) {
        emitEntity("$streams", stream)
        startStream(reaction, stream)
      }
    }

    subscription = input.db.subscribeQuery({
      context_sessions: {
        $: { where: { id: input.sessionId }, limit: 1 },
        context: {},
        trigger: { eventParts: { $: { order: { index: "asc" } } } },
        rootReaction: {
          parent: {},
          causes: { eventParts: { $: { order: { index: "asc" } } } },
          effects: { eventParts: { $: { order: { index: "asc" } } } },
          stream: {},
        },
        reactions: {
          $: { order: { position: "asc" } },
          parent: {},
          causes: { eventParts: { $: { order: { index: "asc" } } } },
          effects: { eventParts: { $: { order: { index: "asc" } } } },
          stream: {},
        },
      },
    }, (payload: any) => {
      if (payload.error) {
        finish(payload.error)
        return
      }
      const session = payload.data?.context_sessions?.[0]
      if (!session) return

      for (const context of asRows(session.context)) emitEntity("context_contexts", context)
      emitEntity("context_sessions", session, [
        "context",
        "trigger",
        "rootReaction",
        "reactions",
      ])
      for (const trigger of asRows(session.trigger)) emitEvent(trigger)
      for (const reaction of asRows(session.rootReaction)) emitReaction(reaction)
      for (const reaction of asRows(session.reactions)) emitReaction(reaction)

      if (session.status === "completed" || session.status === "failed") finish()
    })
  })
}

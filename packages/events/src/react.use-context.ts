"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  consumeReactionStream,
  reduceReactionStream,
  type ReactionStreamChunk,
} from "./context.reaction-stream.js"

import type {
  AppendArgs,
  ContextEventForUI,
  ContextFirstLevel,
  ContextReactionForUI,
  ContextReactionStreamForUI,
  ContextSessionForUI,
  ContextStatus,
  ContextValue,
  SendStatus,
  UseContextOptions,
  UseContextStateHook,
} from "./react.types.js"
import { selectReactionsForStreaming } from "./react.stream-selection.js"
import { INPUT_TEXT_ITEM_TYPE } from "./react.types.js"

type EphemeralEvent = ContextEventForUI & { __contextId: string | null }

type ReactionStreamRuntime = Readonly<{
  streamId: string
  clientId: string
  chunks: readonly ReactionStreamChunk[]
  reader: ContextReactionStreamForUI["reader"]
}>

type ReactionStreamRuntimeMap = Readonly<Record<string, ReactionStreamRuntime>>

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function one(value: unknown): Record<string, any> | null {
  return asRecord(Array.isArray(value) ? value[0] : value)
}

function many(value: unknown): Record<string, any>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is Record<string, any> => Boolean(item))
    : []
}

function uuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, value => {
    const random = Math.random() * 16 | 0
    const nibble = value === "x" ? random : (random & 0x3) | 0x8
    return nibble.toString(16)
  })
}

function normalizeEvent(value: unknown): ContextEventForUI | null {
  const row = asRecord(value)
  if (!row?.id || !row.type) return null
  return {
    id: String(row.id),
    type: String(row.type),
    ...(asText(row.domain) ? { domain: asText(row.domain) } : {}),
    ...(asText(row.name) ? { name: asText(row.name) } : {}),
    ...(asText(row.channel) ? { channel: asText(row.channel) } : {}),
    createdAt: row.createdAt,
    payload: row.payload,
    links: asRecord(row.links) ?? {},
    metadata: asRecord(row.metadata) ?? {},
    durability: "durable",
    eventParts: many(row.eventParts)
      .sort((left, right) => Number(left.index) - Number(right.index))
      .map(part => ({
        id: String(part.id),
        key: String(part.key),
        index: Number(part.index),
        type: String(part.type),
        content: part.content,
        ...(asRecord(part.metadata) ? { metadata: asRecord(part.metadata)! } : {}),
        createdAt: part.createdAt,
        ...(part.updatedAt ? { updatedAt: part.updatedAt } : {}),
      })),
  }
}

function normalizeReactionStream(row: Record<string, any>): ContextReactionStreamForUI | null {
  const linked = one(row.stream)
  const id = asText(row.streamId) || asText(linked?.id)
  const clientId = asText(row.streamClientId) || asText(linked?.clientId)
  if (!id || !clientId) return null
  return {
    id,
    clientId,
    ...(typeof linked?.done === "boolean" ? { done: linked.done } : {}),
    ...(Number.isFinite(Number(linked?.size)) ? { size: Number(linked?.size) } : {}),
    ...(row.streamStartedAt ? { startedAt: row.streamStartedAt } : {}),
    ...(row.streamFinishedAt ? { finishedAt: row.streamFinishedAt } : {}),
    ...(asText(row.streamError) ? { error: asText(row.streamError) } : {}),
    chunks: [],
    reader: { status: "idle", byteOffset: 0, chunkCount: 0 },
  }
}

function normalizeReaction(value: unknown): ContextReactionForUI | null {
  const row = asRecord(value)
  if (!row?.id || !row.type) return null
  const causes = many(row.causes).map(normalizeEvent).filter(Boolean) as ContextEventForUI[]
  const effects = many(row.effects).map(normalizeEvent).filter(Boolean) as ContextEventForUI[]
  const parent = one(row.parent)
  return {
    id: String(row.id),
    type: String(row.type),
    status: row.status,
    createdAt: row.createdAt,
    ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
    position: Number(row.position),
    depth: Number(row.depth),
    causeIds: Array.isArray(row.causeIds) ? row.causeIds.map(String) : causes.map(event => event.id),
    effectIds: Array.isArray(row.effectIds) ? row.effectIds.map(String) : effects.map(event => event.id),
    ...(asText(row.instruction) ? { instruction: asText(row.instruction) } : {}),
    ...(row.error === undefined ? {} : { error: row.error }),
    causes,
    effects,
    stream: normalizeReactionStream(row),
    liveEffects: [],
    parent: parent?.id ? { id: String(parent.id), type: String(parent.type) } : null,
  }
}

function normalizeSession(value: unknown): ContextSessionForUI | null {
  const row = asRecord(value)
  if (!row?.id || !row.definition) return null
  const reactions = many(row.reactions)
    .map(normalizeReaction)
    .filter(Boolean)
    .sort((left, right) => left!.position - right!.position) as ContextReactionForUI[]
  const rootId = one(row.rootReaction)?.id
  return {
    id: String(row.id),
    definition: String(row.definition),
    status: row.status,
    ...(asText(row.sandboxId) ? { sandboxId: asText(row.sandboxId) } : {}),
    ...(asText(row.workflowRunId) ? { workflowRunId: asText(row.workflowRunId) } : {}),
    ...(one(row.parent)?.id ? { parentSessionId: String(one(row.parent)!.id) } : {}),
    ...(row.error === undefined ? {} : { error: row.error }),
    createdAt: row.createdAt,
    ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
    trigger: normalizeEvent(one(row.trigger)),
    rootReaction: reactions.find(reaction => reaction.id === rootId)
      ?? normalizeReaction(one(row.rootReaction)),
    ...(normalizeReaction(one(row.rootReaction))?.parent?.id
      ? { parentReactionId: normalizeReaction(one(row.rootReaction))!.parent!.id }
      : {}),
    reactions,
    children: many(row.children)
      .map(normalizeSession)
      .filter(Boolean) as ContextSessionForUI[],
  }
}

function normalizeContext(value: unknown) {
  const row = asRecord(value)
  if (!row?.id) return { context: null, sessions: [], events: [] }
  const sessions = many(row.sessions)
    .map(normalizeSession)
    .filter(Boolean)
    .sort((left, right) => dateValue(right!.createdAt) - dateValue(left!.createdAt)) as ContextSessionForUI[]
  const currentId = one(row.currentSession)?.id
  const currentSession = sessions.find(session => session.id === currentId)
    ?? sessions.find(session => session.status === "running")
    ?? sessions[0]
    ?? null
  const context: ContextFirstLevel = {
    id: String(row.id),
    key: asText(row.key) || null,
    name: asText(row.name) || null,
    content: row.content,
    ...(row.previous === undefined ? {} : { previous: row.previous }),
    currentSession,
  }
  const events = many(row.events)
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((left, right) => dateValue(left!.createdAt) - dateValue(right!.createdAt)) as ContextEventForUI[]
  return { context, sessions, events }
}

function dateValue(value: unknown) {
  const result = new Date(value as any).getTime()
  return Number.isFinite(result) ? result : 0
}

function flattenSessionReactions(sessions: readonly ContextSessionForUI[]) {
  const byId = new Map<string, ContextReactionForUI>()
  const visit = (session: ContextSessionForUI) => {
    for (const reaction of session.reactions) byId.set(reaction.id, reaction)
    if (session.rootReaction) byId.set(session.rootReaction.id, session.rootReaction)
    session.children.forEach(visit)
  }
  sessions.forEach(visit)
  return [...byId.values()]
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function wait(delay: number) {
  return new Promise<void>(resolve => setTimeout(resolve, delay))
}

function useReactionStreamRuntime(
  db: any,
  reactions: readonly ContextReactionForUI[],
): ReactionStreamRuntimeMap {
  const [runtime, setRuntime] = useState<ReactionStreamRuntimeMap>({})
  const runtimeRef = useRef<ReactionStreamRuntimeMap>({})
  const readers = useRef(new Map<string, {
    key: string
    controller: AbortController
  }>())

  const update = useCallback((
    reactionId: string,
    updater: (current: ReactionStreamRuntime | undefined) => ReactionStreamRuntime,
  ) => {
    setRuntime(current => {
      const next = { ...current, [reactionId]: updater(current[reactionId]) }
      runtimeRef.current = next
      return next
    })
  }, [])

  const targets = useMemo(() => reactions.flatMap(reaction => {
    if (!reaction.stream) return []
    return [{
      reactionId: reaction.id,
      reactionStatus: reaction.status,
      streamId: reaction.stream.id,
      clientId: reaction.stream.clientId,
      done: reaction.stream.done === true,
    }]
  }), [reactions])

  useEffect(() => {
    const targetIds = new Set(targets.map(target => target.reactionId))
    for (const [reactionId, reader] of readers.current) {
      if (targetIds.has(reactionId)) continue
      reader.controller.abort()
      readers.current.delete(reactionId)
    }

    for (const target of targets) {
      const key = `${target.streamId}:${target.clientId}`
      const active = readers.current.get(target.reactionId)
      if (active?.key === key) continue
      if (active) active.controller.abort()
      const previous = runtimeRef.current[target.reactionId]
      if (
        previous?.streamId === target.streamId &&
        previous.reader.status === "completed"
      ) continue

      const controller = new AbortController()
      readers.current.set(target.reactionId, { key, controller })
      const initialOffset = previous?.streamId === target.streamId
        ? previous.reader.byteOffset
        : 0
      update(target.reactionId, current => ({
        streamId: target.streamId,
        clientId: target.clientId,
        chunks: current?.streamId === target.streamId ? current.chunks : [],
        reader: {
          status: "connecting",
          byteOffset: initialOffset,
          chunkCount: current?.streamId === target.streamId
            ? current.reader.chunkCount
            : 0,
        },
      }))

      void (async () => {
        let byteOffset = initialOffset
        let failures = 0
        while (!controller.signal.aborted) {
          const pending: ReactionStreamChunk[] = []
          let flushTimer: ReturnType<typeof setTimeout> | undefined
          const flush = () => {
            if (flushTimer) clearTimeout(flushTimer)
            flushTimer = undefined
            if (pending.length === 0) return
            const batch = pending.splice(0)
            update(target.reactionId, current => {
              const chunks = new Map<number, ReactionStreamChunk>()
              for (const chunk of current?.chunks ?? []) chunks.set(chunk.sequence, chunk)
              for (const chunk of batch) chunks.set(chunk.sequence, chunk)
              const ordered = [...chunks.values()].sort((left, right) =>
                left.sequence - right.sequence)
              return {
                streamId: target.streamId,
                clientId: target.clientId,
                chunks: ordered,
                reader: {
                  status: "streaming",
                  byteOffset,
                  chunkCount: ordered.length,
                },
              }
            })
          }
          const scheduleFlush = () => {
            if (flushTimer) return
            flushTimer = setTimeout(flush, 16)
          }
          try {
            await consumeReactionStream({
              db,
              streamId: target.streamId,
              clientId: target.clientId,
              byteOffset,
              signal: controller.signal,
              onByteOffset: next => {
                byteOffset = next
                scheduleFlush()
              },
              onChunk: chunk => {
                pending.push(chunk)
                scheduleFlush()
              },
            })
            flush()
            if (controller.signal.aborted) return
            update(target.reactionId, current => ({
              streamId: target.streamId,
              clientId: target.clientId,
              chunks: current?.chunks ?? [],
              reader: {
                status: "completed",
                byteOffset,
                chunkCount: current?.chunks.length ?? 0,
              },
            }))
            return
          } catch (error) {
            flush()
            if (controller.signal.aborted) return
            failures += 1
            const terminal = failures >= 6
            update(target.reactionId, current => ({
              streamId: target.streamId,
              clientId: target.clientId,
              chunks: current?.chunks ?? [],
              reader: {
                status: terminal ? "error" : "reconnecting",
                byteOffset,
                chunkCount: current?.chunks.length ?? 0,
                error: errorText(error),
              },
            }))
            if (terminal) return
            await wait(Math.min(2_000, 150 * 2 ** (failures - 1)))
          }
        }
      })().finally(() => {
        const activeReader = readers.current.get(target.reactionId)
        if (activeReader?.controller === controller) {
          readers.current.delete(target.reactionId)
        }
      })
    }
  }, [db, targets, update])

  useEffect(() => () => {
    readers.current.forEach(reader => reader.controller.abort())
    readers.current.clear()
  }, [])

  return runtime
}

function buildLiveEffects(
  reaction: ContextReactionForUI,
  stream: ContextReactionStreamForUI,
): ContextEventForUI[] {
  if (stream.chunks.length === 0) return []
  let projections
  try {
    projections = reduceReactionStream(stream.chunks)
  } catch {
    return []
  }
  return projections.map(projection => ({
    id: projection.eventId,
    type: projection.eventType,
    ...(projection.channel ? { channel: projection.channel } : {}),
    createdAt: projection.createdAt,
    payload: null,
    links: {},
    metadata: {
      provisional: true,
      reactionId: reaction.id,
      streamId: stream.id,
      streamStatus: projection.status,
    },
    eventParts: projection.parts.map((part, index) => ({
      id: `${projection.eventId}:stream:${index}`,
      key: `${projection.eventId}:stream:${index}`,
      index,
      type: part.type,
      content: part.content,
      ...(part.reactorMetadata ? { metadata: part.reactorMetadata } : {}),
      createdAt: projection.createdAt,
    })),
    durability: "streaming",
  }))
}

function enrichReaction(
  reaction: ContextReactionForUI,
  runtime: ReactionStreamRuntime | undefined,
  durableEventIds: ReadonlySet<string>,
): ContextReactionForUI {
  if (!reaction.stream) return reaction
  const stream: ContextReactionStreamForUI = {
    ...reaction.stream,
    ...(runtime
      ? { chunks: [...runtime.chunks], reader: runtime.reader }
      : {}),
  }
  const candidates = buildLiveEffects(reaction, stream)
  return {
    ...reaction,
    stream,
    liveEffects: candidates.filter(candidate => !durableEventIds.has(candidate.id)),
  }
}

function enrichSession(
  session: ContextSessionForUI,
  runtime: ReactionStreamRuntimeMap,
  durableEventIds: ReadonlySet<string>,
): ContextSessionForUI {
  const reactions = session.reactions.map(reaction =>
    enrichReaction(reaction, runtime[reaction.id], durableEventIds))
  const rootReaction = session.rootReaction
    ? reactions.find(reaction => reaction.id === session.rootReaction!.id)
      ?? enrichReaction(
        session.rootReaction,
        runtime[session.rootReaction.id],
        durableEventIds,
      )
    : null
  return {
    ...session,
    rootReaction,
    reactions,
    children: session.children.map(child => enrichSession(child, runtime, durableEventIds)),
  }
}

function sessionQuery() {
  return {
    $: { order: { createdAt: "desc" } },
    trigger: { eventParts: {} },
    parent: {},
    rootReaction: {
      causes: { eventParts: {} },
      effects: { eventParts: {} },
      parent: {},
      stream: {},
    },
    reactions: {
      $: { order: { position: "asc" } },
      causes: { eventParts: {} },
      effects: { eventParts: {} },
      parent: {},
      stream: {},
    },
  }
}

const useDefaultState: UseContextStateHook = (db, { contextId, contextKey }) => {
  const result = db.useQuery(contextId || contextKey ? {
    context_contexts: {
      $: {
        where: contextId ? { id: contextId } : { key: contextKey },
      },
      currentSession: {},
      events: {
        $: { order: { createdAt: "asc" } },
        eventParts: { $: { order: { index: "asc" } } },
      },
      sessions: {
        ...sessionQuery(),
        children: sessionQuery(),
      },
    },
  } : null)
  return { context: result?.data?.context_contexts?.[0] ?? null }
}

function optimisticEvent(message: { id: string; parts: any[] }, contextId: string) {
  return {
    __contextId: contextId,
    id: message.id,
    type: INPUT_TEXT_ITEM_TYPE,
    channel: "web",
    createdAt: new Date().toISOString(),
    payload: {},
    links: {},
    metadata: { optimistic: true },
    durability: "optimistic",
    eventParts: [{
      id: `${message.id}:0`,
      key: `${message.id}:0`,
      index: 0,
      type: "message",
      content: { blocks: message.parts },
      createdAt: new Date().toISOString(),
    }],
  } satisfies EphemeralEvent
}

export function useContext(db: any, options: UseContextOptions): ContextValue {
  const {
    apiUrl,
    initialContextId,
    contextKey,
    onContextUpdate,
    prepareAppendArgs,
    prepareRequestBody,
    streamReactionIds,
    state: useStateImpl = useDefaultState,
  } = options
  const [contextId, setContextId] = useState<string | null>(initialContextId ?? null)
  const [optimistic, setOptimistic] = useState<EphemeralEvent[]>([])
  const [sendError, setSendError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const controllers = useRef(new Set<AbortController>())
  const selectedContextId = useRef(contextId)

  useEffect(() => setContextId(initialContextId ?? null), [initialContextId])
  useEffect(() => { selectedContextId.current = contextId }, [contextId])

  const state = useStateImpl(db, { contextId, contextKey })
  const normalized = useMemo(() => normalizeContext(state.context), [state.context])
  const allReactions = useMemo(
    () => flattenSessionReactions(normalized.sessions),
    [normalized.sessions],
  )
  const streamedReactions = useMemo(
    () => selectReactionsForStreaming(allReactions, streamReactionIds),
    [allReactions, streamReactionIds],
  )
  const streamRuntime = useReactionStreamRuntime(db, streamedReactions)
  const durableEventIds = useMemo(
    () => new Set(normalized.events.map(event => event.id)),
    [normalized.events],
  )
  const sessions = useMemo(
    () => normalized.sessions.map(session =>
      enrichSession(session, streamRuntime, durableEventIds)),
    [durableEventIds, normalized.sessions, streamRuntime],
  )
  const activeSessionId = normalized.context?.currentSession?.id ?? null
  const active = sessions.find(session => session.id === activeSessionId)
    ?? sessions.find(session => session.status === "running")
    ?? sessions[0]
    ?? null
  const context = useMemo(() => normalized.context
    ? { ...normalized.context, currentSession: active }
    : null, [active, normalized.context])
  useEffect(() => {
    if (!normalized.context || normalized.context.id === contextId) return
    setContextId(normalized.context.id)
    onContextUpdate?.(normalized.context.id)
  }, [contextId, normalized.context, onContextUpdate])

  useEffect(() => {
    const ids = new Set(normalized.events.map(event => event.id))
    setOptimistic(current => current.filter(event => !ids.has(event.id)))
  }, [normalized.events])

  const stop = useCallback(() => {
    controllers.current.forEach(controller => controller.abort())
    controllers.current.clear()
  }, [])

  const append = useCallback(async (args: AppendArgs) => {
    const prepared = prepareAppendArgs ? await prepareAppendArgs(args) : args
    if (!prepared.parts.length) return
    const activeContextId = selectedContextId.current ?? uuid()
    if (!selectedContextId.current) {
      selectedContextId.current = activeContextId
      setContextId(activeContextId)
      onContextUpdate?.(activeContextId)
    }
    const message = { id: uuid(), role: "user", parts: prepared.parts }
    const baseBody = {
      messages: [message],
      webSearch: prepared.webSearch,
      reasoningLevel: prepared.reasoningLevel,
      contextId: activeContextId,
    }
    const body = prepareRequestBody ? await prepareRequestBody(baseBody) : baseBody
    const pendingEvent = optimisticEvent(message, activeContextId)
    setOptimistic(current => [...current, pendingEvent])
    setSendError(null)
    setPending(value => value + 1)
    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, contextId: asText(body.contextId) || activeContextId }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(await response.text() || `Request failed: ${response.status}`)
      const result = await response.json().catch(() => null)
      const nextContextId = asText(result?.contextId)
      if (nextContextId && nextContextId !== selectedContextId.current) {
        selectedContextId.current = nextContextId
        setContextId(nextContextId)
        onContextUpdate?.(nextContextId)
      }
      const returnedEvent = normalizeEvent(result?.event ?? result?.assistantEvent)
      if (returnedEvent) {
        setOptimistic(current => [
          ...current.filter(event => event.id !== returnedEvent.id),
          { ...returnedEvent, __contextId: nextContextId || activeContextId },
        ])
      }
    } catch (error) {
      setOptimistic(current => current.filter(event => event.id !== pendingEvent.id))
      const message = error instanceof Error ? error.message : "Request failed"
      setSendError(message)
      throw error
    } finally {
      controllers.current.delete(controller)
      setPending(value => Math.max(0, value - 1))
    }
  }, [apiUrl, onContextUpdate, prepareAppendArgs, prepareRequestBody])

  const events = useMemo(() => {
    const persisted = new Set(normalized.events.map(event => event.id))
    const live = flattenSessionReactions(sessions)
      .flatMap(reaction => reaction.liveEffects)
    const candidates = [
      ...normalized.events,
      ...live.filter(event => !persisted.has(event.id)),
      ...optimistic.filter(event =>
        event.__contextId === contextId && !persisted.has(event.id)),
    ]
    const byId = new Map<string, ContextEventForUI>()
    for (const event of candidates) {
      const existing = byId.get(event.id)
      if (!existing || existing.durability !== "durable") byId.set(event.id, event)
    }
    return [...byId.values()]
      .sort((left, right) => dateValue(left.createdAt) - dateValue(right.createdAt))
  }, [contextId, normalized.events, optimistic, sessions])
  const contextStatus: ContextStatus = active?.status === "running"
    ? "running"
    : active?.status === "failed"
      ? "failed"
      : "idle"
  const hasStreamingReaction = flattenSessionReactions(sessions).some(reaction =>
    reaction.stream?.reader.status === "connecting" ||
    reaction.stream?.reader.status === "streaming" ||
    reaction.stream?.reader.status === "reconnecting")
  const sendStatus: SendStatus = sendError
    ? "error"
    : hasStreamingReaction
      ? "streaming"
      : pending > 0
        ? "submitting"
        : "idle"

  return {
    apiUrl,
    context,
    contextId,
    contextStatus,
    activeSessionId: active?.id ?? null,
    sessions,
    reactions: active?.reactions ?? [],
    events,
    sendStatus,
    sendError,
    stop,
    append,
  }
}

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type {
  AppendArgs,
  ContextEventForUI,
  ContextFirstLevel,
  ContextReactionForUI,
  ContextSessionForUI,
  ContextStatus,
  ContextValue,
  SendStatus,
  UseContextOptions,
  UseContextStateHook,
} from "./react.types.js"
import { INPUT_TEXT_ITEM_TYPE } from "./react.types.js"

type EphemeralEvent = ContextEventForUI & { __contextId: string | null }

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
    position: Number(row.position),
    depth: Number(row.depth),
    causeIds: Array.isArray(row.causeIds) ? row.causeIds.map(String) : causes.map(event => event.id),
    effectIds: Array.isArray(row.effectIds) ? row.effectIds.map(String) : effects.map(event => event.id),
    ...(asText(row.instruction) ? { instruction: asText(row.instruction) } : {}),
    ...(row.error === undefined ? {} : { error: row.error }),
    causes,
    effects,
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
    ...(row.error === undefined ? {} : { error: row.error }),
    createdAt: row.createdAt,
    ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
    trigger: normalizeEvent(one(row.trigger)),
    rootReaction: reactions.find(reaction => reaction.id === rootId)
      ?? normalizeReaction(one(row.rootReaction)),
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

function sessionQuery() {
  return {
    $: { order: { createdAt: "desc" }, limit: 100 },
    trigger: { eventParts: {} },
    rootReaction: {
      causes: { eventParts: {} },
      effects: { eventParts: {} },
      parent: {},
    },
    reactions: {
      $: { order: { position: "asc" }, limit: 500 },
      causes: { eventParts: {} },
      effects: { eventParts: {} },
      parent: {},
    },
  }
}

const useDefaultState: UseContextStateHook = (db, { contextId, contextKey }) => {
  const result = db.useQuery(contextId || contextKey ? {
    context_contexts: {
      $: {
        where: contextId ? { id: contextId } : { key: contextKey },
        limit: 1,
      },
      currentSession: {},
      events: {
        $: { order: { createdAt: "asc" }, limit: 2_000 },
        eventParts: { $: { order: { index: "asc" }, limit: 5_000 } },
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
    return [
      ...normalized.events,
      ...optimistic.filter(event =>
        event.__contextId === contextId && !persisted.has(event.id)),
    ].sort((left, right) => dateValue(left.createdAt) - dateValue(right.createdAt))
  }, [contextId, normalized.events, optimistic])
  const active = normalized.context?.currentSession ?? null
  const contextStatus: ContextStatus = active?.status === "running"
    ? "running"
    : active?.status === "failed"
      ? "failed"
      : "idle"
  const sendStatus: SendStatus = sendError ? "error" : pending > 0 ? "submitting" : "idle"

  return {
    apiUrl,
    context: normalized.context,
    contextId,
    contextStatus,
    activeSessionId: active?.id ?? null,
    sessions: normalized.sessions,
    reactions: active?.reactions ?? [],
    events,
    sendStatus,
    sendError,
    stop,
    append,
  }
}

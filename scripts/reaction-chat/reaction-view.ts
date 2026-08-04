import {
  reduceReactionStream,
  type ReactionStreamChunk,
  type ReactionStreamProjection,
  type SessionLogRecord,
} from "../../packages/events/src/index.ts"
import type {
  ContextEventForUI,
  ContextReactionForUI,
  ContextSessionForUI,
} from "../../packages/events/src/react.types.ts"
import {
  buildEventTimeline,
  type EventTimeline,
} from "../../packages/registry/components/ekairos/reactions/reaction-graph.ts"

type EntityRecord = Extract<SessionLogRecord, { kind: "entity" }>
export type ReactionEntityName = EntityRecord["entity"]

export type ReactionStreamView = Readonly<{
  reactionId: string
  streamId: string
  text: string
  chunkCount: number
  textDeltas: number
  lastKind: string
  chunks: readonly ReactionStreamChunk[]
  projections: readonly ReactionStreamProjection[]
  round?: number
  error?: string
}>

export type ReactionGraphState = Readonly<{
  entities: Readonly<Record<
    ReactionEntityName,
    Readonly<Record<string, Readonly<Record<string, unknown>>>>
  >>
  streams: Readonly<Record<string, ReactionStreamView>>
  streamOrder: readonly string[]
}>

const entityNames: readonly ReactionEntityName[] = [
  "context_contexts",
  "context_sessions",
  "context_reactions",
  "context_events",
  "context_eventParts",
  "$streams",
]

export function emptyReactionGraph(): ReactionGraphState {
  return Object.freeze({
    entities: Object.freeze(Object.fromEntries(
      entityNames.map(name => [name, Object.freeze({})]),
    ) as ReactionGraphState["entities"]),
    streams: Object.freeze({}),
    streamOrder: Object.freeze([]),
  })
}

function chunkRound(chunk: unknown): number | undefined {
  if (!chunk || typeof chunk !== "object") return undefined
  const round = (chunk as { round?: unknown }).round
  return typeof round === "number" ? round : undefined
}

function chunkDelta(chunk: ReactionStreamChunk): string {
  return chunk.kind === "text.delta" && typeof chunk.delta === "string"
    ? chunk.delta
    : ""
}

export function reduceSessionLog(
  state: ReactionGraphState,
  record: SessionLogRecord,
): ReactionGraphState {
  if (record.kind === "entity") {
    return Object.freeze({
      ...state,
      entities: Object.freeze({
        ...state.entities,
        [record.entity]: Object.freeze({
          ...state.entities[record.entity],
          [record.id]: record.value,
        }),
      }),
    })
  }

  const previous = state.streams[record.reactionId]
  if (record.kind === "stream.error") {
    const stream = Object.freeze({
      reactionId: record.reactionId,
      streamId: record.streamId,
      text: previous?.text ?? "",
      chunkCount: previous?.chunkCount ?? 0,
      textDeltas: previous?.textDeltas ?? 0,
      lastKind: "stream.error",
      chunks: previous?.chunks ?? Object.freeze([]),
      projections: previous?.projections ?? Object.freeze([]),
      ...(previous?.round === undefined ? {} : { round: previous.round }),
      error: record.error,
    })
    return Object.freeze({
      ...state,
      streams: Object.freeze({ ...state.streams, [record.reactionId]: stream }),
      streamOrder: previous
        ? state.streamOrder
        : Object.freeze([...state.streamOrder, record.reactionId]),
    })
  }

  const chunksBySequence = new Map(
    (previous?.chunks ?? []).map(chunk => [chunk.sequence, chunk]),
  )
  chunksBySequence.set(record.chunk.sequence, record.chunk)
  const chunks = Object.freeze(
    [...chunksBySequence.values()].sort((left, right) => left.sequence - right.sequence),
  )
  const projections = chunks.some(chunk => chunk.eventId)
    ? reduceReactionStream(chunks)
    : Object.freeze([])
  const round = chunkRound(record.chunk)
  const stream = Object.freeze({
    reactionId: record.reactionId,
    streamId: record.streamId,
    text: chunks.map(chunkDelta).join(""),
    chunkCount: chunks.length,
    textDeltas: chunks.filter(chunk => chunk.kind === "text.delta").length,
    lastKind: record.chunk.kind,
    chunks,
    projections,
    ...(round === undefined && previous?.round === undefined
      ? {}
      : { round: round ?? previous?.round }),
  })
  return Object.freeze({
    ...state,
    streams: Object.freeze({ ...state.streams, [record.reactionId]: stream }),
    streamOrder: previous
      ? state.streamOrder
      : Object.freeze([...state.streamOrder, record.reactionId]),
  })
}

export function relationIds(
  entity: Readonly<Record<string, unknown>> | undefined,
  relation: string,
): readonly string[] {
  const links = entity?.links
  if (!links || typeof links !== "object") return []
  const ids = (links as Record<string, unknown>)[relation]
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : Object.freeze({})
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value ? value : fallback
}

function dateValue(value: unknown): string | Date {
  return value instanceof Date || typeof value === "string"
    ? value
    : new Date(0)
}

function durableEvent(
  graph: ReactionGraphState,
  id: string,
): ContextEventForUI | null {
  const value = graph.entities.context_events[id]
  if (!value) return null
  const eventParts = relationIds(value, "eventParts")
    .map(partId => graph.entities.context_eventParts[partId])
    .filter((part): part is Readonly<Record<string, unknown>> => Boolean(part))
    .sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0))
    .map(part => ({
      id: stringValue(part.id),
      key: stringValue(part.key),
      index: Number(part.index ?? 0),
      type: stringValue(part.type, "unknown"),
      content: part.content,
      createdAt: dateValue(part.createdAt),
      ...(part.updatedAt ? { updatedAt: dateValue(part.updatedAt) } : {}),
    }))
  return {
    id,
    type: stringValue(value.type, "event"),
    ...(value.domain ? { domain: String(value.domain) } : {}),
    ...(value.name ? { name: String(value.name) } : {}),
    ...(value.channel ? { channel: String(value.channel) } : {}),
    createdAt: dateValue(value.createdAt),
    payload: value.payload,
    links: Object.fromEntries(
      Object.entries(record(value.links)).filter(([, linked]) =>
        typeof linked === "string" || Array.isArray(linked)),
    ) as Record<string, string | string[]>,
    metadata: { ...record(value.metadata) },
    eventParts,
    durability: "durable",
  }
}

function liveEvent(projection: ReactionStreamProjection): ContextEventForUI {
  const parts = projection.parts.map((part, index) => ({
    id: `${projection.eventId}:live:${index}`,
    key: `${projection.eventId}:live:${index}`,
    index,
    type: part.type,
    content: part.content,
    createdAt: projection.createdAt,
  }))
  const message = [...parts].reverse().find(part => part.type === "message")
  const content = record(message?.content)
  return {
    id: projection.eventId,
    type: projection.eventType,
    ...(projection.channel ? { channel: projection.channel } : {}),
    createdAt: projection.createdAt,
    payload: typeof content.text === "string" ? { text: content.text } : {},
    links: {},
    metadata: {},
    eventParts: parts,
    durability: "streaming",
  }
}

function reactionForUI(
  graph: ReactionGraphState,
  id: string,
): ContextReactionForUI | null {
  const value = graph.entities.context_reactions[id]
  if (!value) return null
  const causes = relationIds(value, "causes")
    .map(eventId => durableEvent(graph, eventId))
    .filter((event): event is ContextEventForUI => Boolean(event))
  const effects = relationIds(value, "effects")
    .map(eventId => durableEvent(graph, eventId))
    .filter((event): event is ContextEventForUI => Boolean(event))
  const durableEffectIds = new Set(effects.map(event => event.id))
  const liveEffects = (graph.streams[id]?.projections ?? [])
    .filter(projection => !durableEffectIds.has(projection.eventId))
    .map(liveEvent)
  const parentId = relationIds(value, "parent")[0]
  const parent = parentId ? graph.entities.context_reactions[parentId] : undefined
  const status = value.status === "completed" || value.status === "failed"
    ? value.status
    : "running"
  return {
    id,
    type: stringValue(value.type, "reaction"),
    status,
    createdAt: dateValue(value.createdAt),
    ...(value.updatedAt ? { updatedAt: dateValue(value.updatedAt) } : {}),
    position: Number(value.position ?? 0),
    depth: Number(value.depth ?? 0),
    causeIds: causes.map(event => event.id),
    effectIds: effects.map(event => event.id),
    ...(value.instruction ? { instruction: String(value.instruction) } : {}),
    ...(value.error === undefined ? {} : { error: value.error }),
    causes,
    effects,
    stream: null,
    liveEffects,
    parent: parentId
      ? { id: parentId, type: stringValue(parent?.type, "reaction") }
      : null,
  }
}

const EMPTY_TIMELINE: EventTimeline = Object.freeze({
  rows: Object.freeze([]),
  edges: Object.freeze([]),
  lanes: 1,
})

export function projectSessionTimeline(
  graph: ReactionGraphState,
  sessionId: string | undefined,
): EventTimeline {
  const value = sessionId ? graph.entities.context_sessions[sessionId] : undefined
  if (!value || !sessionId) return EMPTY_TIMELINE
  const reactions = relationIds(value, "reactions")
    .map(reactionId => reactionForUI(graph, reactionId))
    .filter((reaction): reaction is ContextReactionForUI => Boolean(reaction))
  const rootId = relationIds(value, "rootReaction")[0]
  const triggerId = relationIds(value, "trigger")[0]
  const status = value.status === "completed" || value.status === "failed"
    ? value.status
    : "running"
  const session: ContextSessionForUI = {
    id: sessionId,
    definition: stringValue(value.definition, "session"),
    status,
    ...(value.sandboxId ? { sandboxId: String(value.sandboxId) } : {}),
    ...(value.workflowRunId ? { workflowRunId: String(value.workflowRunId) } : {}),
    createdAt: dateValue(value.createdAt),
    ...(value.updatedAt ? { updatedAt: dateValue(value.updatedAt) } : {}),
    trigger: triggerId ? durableEvent(graph, triggerId) : null,
    rootReaction: reactions.find(reaction => reaction.id === rootId) ?? null,
    reactions,
    children: [],
  }
  return buildEventTimeline(session)
}

import { uuidV5 } from "../context.part-identity.js"
import type {
  ContextEvent,
  ContextEventPart,
  ContextIdentifier,
  ContextReaction,
  ContextSession,
  ContextStore,
  ReactionStatus,
  SaveContextEventInput,
  SessionStatus,
  StoredContext,
} from "../context.store.js"

const EVENT_PART_NAMESPACE = "f729b6df-52de-4b3c-a88e-72325e181c81"

function date(value: unknown): Date {
  if (value instanceof Date) return value
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.valueOf())) throw new Error("context_invalid_date")
  return parsed
}

function optionalDate(value: unknown): Date | undefined {
  return value == null ? undefined : date(value)
}

function linkedId(value: unknown): string | undefined {
  const linked = Array.isArray(value) ? value[0] : value
  if (!linked || typeof linked !== "object") return undefined
  return typeof (linked as any).id === "string" ? (linked as any).id : undefined
}

function linkedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => linkedId(item) ?? [])
}

function plainError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  return { name: error.name, message: error.message, stack: error.stack }
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function toContext<Content>(row: any): StoredContext<Content> {
  return Object.freeze({
    id: String(row.id),
    key: typeof row.key === "string" ? row.key : null,
    ...(typeof row.name === "string" ? { name: row.name } : {}),
    content: (row.content ?? null) as Content | null,
    ...(row.previous === undefined ? {} : { previous: row.previous as Content }),
    createdAt: date(row.createdAt),
    ...(row.updatedAt == null ? {} : { updatedAt: date(row.updatedAt) }),
  })
}

function toPart(row: any): ContextEventPart {
  return Object.freeze({
    id: String(row.id),
    key: String(row.key),
    index: Number(row.index),
    type: String(row.type),
    content: row.content,
    ...(row.metadata == null ? {} : { metadata: Object.freeze({ ...row.metadata }) }),
    createdAt: date(row.createdAt),
    ...(row.updatedAt == null ? {} : { updatedAt: date(row.updatedAt) }),
  })
}

function toEvent<Payload>(row: any): ContextEvent<Payload> {
  return Object.freeze({
    id: String(row.id),
    type: String(row.type),
    createdAt: date(row.createdAt),
    ...(linkedId(row.context) ? { contextId: linkedId(row.context)! } : {}),
    ...(typeof row.domain === "string" ? { domain: row.domain } : {}),
    ...(typeof row.name === "string" ? { name: row.name } : {}),
    ...(typeof row.channel === "string" ? { channel: row.channel } : {}),
    payload: row.payload as Payload,
    links: Object.freeze({ ...(row.links ?? {}) }),
    physicalLinks: Object.freeze({ ...(row.physicalLinks ?? {}) }),
    metadata: Object.freeze({ ...(row.metadata ?? {}) }),
    eventParts: Object.freeze(
      [...(row.eventParts ?? [])]
        .sort((left, right) => Number(left.index) - Number(right.index))
        .map(toPart),
    ),
  })
}

function toSession(row: any): ContextSession {
  return Object.freeze({
    id: String(row.id),
    contextId: linkedId(row.context) ?? String(row.contextId ?? ""),
    definition: String(row.definition),
    triggerId: linkedId(row.trigger) ?? String(row.triggerId ?? ""),
    rootReactionId: linkedId(row.rootReaction) ?? String(row.rootReactionId ?? ""),
    status: row.status as SessionStatus,
    ...(linkedId(row.parent) ? { parentSessionId: linkedId(row.parent)! } : {}),
    ...(typeof row.sandboxId === "string" ? { sandboxId: row.sandboxId } : {}),
    ...(typeof row.workflowRunId === "string" ? { workflowRunId: row.workflowRunId } : {}),
    ...(row.error === undefined ? {} : { error: row.error }),
    createdAt: date(row.createdAt),
    ...(row.updatedAt == null ? {} : { updatedAt: date(row.updatedAt) }),
  })
}

function toReaction(row: any): ContextReaction {
  return Object.freeze({
    id: String(row.id),
    sessionId: linkedId(row.session) ?? String(row.sessionId ?? ""),
    type: String(row.type),
    status: row.status as ReactionStatus,
    position: Number(row.position),
    depth: Number(row.depth),
    causeIds: Object.freeze(
      Array.isArray(row.causeIds) ? row.causeIds.map(String) : linkedIds(row.causes),
    ),
    effectIds: Object.freeze(
      Array.isArray(row.effectIds) ? row.effectIds.map(String) : linkedIds(row.effects),
    ),
    ...(linkedId(row.parent) ? { parentReactionId: linkedId(row.parent)! } : {}),
    ...(typeof row.instruction === "string" ? { instruction: row.instruction } : {}),
    ...(row.error === undefined ? {} : { error: row.error }),
    createdAt: date(row.createdAt),
    ...(row.updatedAt == null ? {} : { updatedAt: date(row.updatedAt) }),
  })
}

export class InstantStore implements ContextStore {
  constructor(readonly db: any) {}

  private async contextRow(identifier: ContextIdentifier) {
    const where = "id" in identifier ? { id: identifier.id } : { key: identifier.key }
    const result = await this.db.query({
      context_contexts: { $: { where, limit: 1 } },
    } as any)
    return result?.context_contexts?.[0] ?? null
  }

  async getContext<Content>(identifier: ContextIdentifier) {
    const row = await this.contextRow(identifier)
    return row ? toContext<Content>(row) : null
  }

  async getOrCreateContext<Content>(identifier: ContextIdentifier) {
    const existing = await this.getContext<Content>(identifier)
    if (existing) return existing

    const id: string = "id" in identifier && typeof identifier.id === "string"
      ? identifier.id
      : globalThis.crypto.randomUUID()
    const createdAt = new Date()
    const attrs = {
      ...(typeof identifier.key === "string" ? { key: identifier.key } : {}),
      createdAt,
    }
    try {
      await this.db.transact([this.db.tx.context_contexts[id].create(attrs)])
    } catch (error) {
      const raced = await this.getContext<Content>(identifier)
      if (raced) return raced
      throw error
    }
    return toContext<Content>({ id, ...attrs, content: null })
  }

  async updateContextContent<Content>(identifier: ContextIdentifier, content: Content) {
    const current = await this.getContext<Content>(identifier)
    if (!current) throw new Error("context_not_found")
    if (same(current.content, content)) return current
    const updatedAt = new Date()
    await this.db.transact([
      this.db.tx.context_contexts[current.id].update({
        content,
        ...(current.content === null ? {} : { previous: current.content }),
        updatedAt,
      }),
    ])
    return Object.freeze({
      ...current,
      content,
      ...(current.content === null ? {} : { previous: current.content as Content }),
      updatedAt,
    })
  }

  private async eventRow(eventId: string) {
    const result = await this.db.query({
      context_events: {
        $: { where: { id: eventId }, limit: 1 },
        context: {},
        eventParts: { $: { order: { index: "asc" } } },
      },
    } as any)
    return result?.context_events?.[0] ?? null
  }

  async getEvent<Payload = unknown>(eventId: string) {
    const row = await this.eventRow(eventId)
    return row ? toEvent<Payload>(row) : null
  }

  async getEvents(identifier: ContextIdentifier) {
    const where = "id" in identifier ? { id: identifier.id } : { key: identifier.key }
    const result = await this.db.query({
      context_contexts: {
        $: { where, limit: 1 },
        events: {
          $: { order: { createdAt: "asc" } },
          eventParts: { $: { order: { index: "asc" } } },
        },
      },
    } as any)
    return Object.freeze((result?.context_contexts?.[0]?.events ?? []).map(toEvent))
  }

  async saveEvent<Payload>(
    event: SaveContextEventInput<Payload>,
    origin?: ContextIdentifier,
  ): Promise<ContextEvent<Payload>> {
    const existing = await this.getEvent<Payload>(event.id)
    const originContext = origin ? await this.getContext(origin) : null
    if (origin && !originContext) throw new Error("context_event_origin_not_found")

    const expected = {
      id: event.id,
      type: event.type,
      createdAt: event.createdAt,
      domain: event.domain,
      name: event.name,
      channel: event.channel,
      payload: event.payload,
      links: event.links,
      physicalLinks: event.physicalLinks,
      metadata: event.metadata,
      contextId: originContext?.id,
    }
    if (existing) {
      const actual = {
        id: existing.id,
        type: existing.type,
        createdAt: existing.createdAt,
        domain: existing.domain,
        name: existing.name,
        channel: existing.channel,
        payload: existing.payload,
        links: existing.links,
        physicalLinks: existing.physicalLinks,
        metadata: existing.metadata,
        contextId: existing.contextId,
      }
      if (!same(actual, expected)) throw new Error(`context_event_conflict:${event.id}`)
      if (event.eventParts) await this.saveEventParts(event.id, event.eventParts)
      return (await this.getEvent<Payload>(event.id))!
    }

    const attrs = {
      type: event.type,
      createdAt: event.createdAt,
      ...(event.domain ? { domain: event.domain } : {}),
      ...(event.name ? { name: event.name } : {}),
      ...(event.channel ? { channel: event.channel } : {}),
      ...(event.payload === undefined ? {} : { payload: event.payload }),
      ...(Object.keys(event.links).length === 0 ? {} : { links: event.links }),
      ...(Object.keys(event.physicalLinks).length === 0 ? {} : { physicalLinks: event.physicalLinks }),
      ...(Object.keys(event.metadata).length === 0 ? {} : { metadata: event.metadata }),
    }
    const physical = Object.fromEntries(
      Object.entries(event.links).map(([alias, value]) => {
        const mapping = event.physicalLinks[alias]
        if (!mapping) throw new Error(`context_event_link_mapping_missing:${event.type}:${alias}`)
        return [mapping.forwardLabel, value]
      }),
    )
    const links = {
      ...physical,
      ...(originContext ? { context: originContext.id } : {}),
    }
    let tx = this.db.tx.context_events[event.id].create(attrs)
    if (Object.keys(links).length > 0) tx = tx.link(links)
    try {
      await this.db.transact([tx])
    } catch (error) {
      const raced = await this.getEvent<Payload>(event.id)
      if (!raced) throw error
      return await this.saveEvent(event, origin)
    }
    if (event.eventParts) await this.saveEventParts(event.id, event.eventParts)
    return (await this.getEvent<Payload>(event.id))!
  }

  async saveEventParts(
    eventId: string,
    parts: readonly Omit<ContextEventPart, "id" | "key" | "createdAt">[],
  ) {
    if (!(await this.getEvent(eventId))) throw new Error(`context_event_not_found:${eventId}`)
    const current = (await this.getEvent(eventId))!.eventParts
    const expected = parts.map(part => ({
      index: part.index,
      type: part.type,
      content: part.content,
      metadata: part.metadata,
    }))
    const actual = current.map(part => ({
      index: part.index,
      type: part.type,
      content: part.content,
      metadata: part.metadata,
    }))
    if (current.length > 0) {
      if (!same(actual, expected)) throw new Error(`context_event_parts_conflict:${eventId}`)
      return current
    }

    const createdAt = new Date()
    const chunks = parts.map(part => {
      const key = `${eventId}:${part.index}`
      const id = uuidV5(key, EVENT_PART_NAMESPACE)
      return this.db.tx.context_eventParts[id]
        .create({
          key,
          index: part.index,
          type: part.type,
          content: part.content,
          ...(part.metadata ? { metadata: part.metadata } : {}),
          createdAt,
        })
        .link({ event: eventId })
    })
    if (chunks.length > 0) await this.db.transact(chunks)
    return (await this.getEvent(eventId))!.eventParts
  }

  private async sessionRow(sessionId: string) {
    const result = await this.db.query({
      context_sessions: {
        $: { where: { id: sessionId }, limit: 1 },
        context: {},
        trigger: {},
        rootReaction: {},
        parent: {},
      },
    } as any)
    return result?.context_sessions?.[0] ?? null
  }

  async getSession(sessionId: string) {
    const row = await this.sessionRow(sessionId)
    return row ? toSession(row) : null
  }

  async openSession(input: Parameters<ContextStore["openSession"]>[0]) {
    const existing = await this.getSession(input.id)
    if (existing) {
      const expected = {
        contextId: input.contextId,
        definition: input.definition,
        triggerId: input.triggerId,
        rootReactionId: input.rootReactionId,
        parentSessionId: input.parentSessionId,
        sandboxId: input.sandboxId,
      }
      const actual = {
        contextId: existing.contextId,
        definition: existing.definition,
        triggerId: existing.triggerId,
        rootReactionId: existing.rootReactionId,
        parentSessionId: existing.parentSessionId,
        sandboxId: existing.sandboxId,
      }
      if (!same(actual, expected)) throw new Error(`context_session_conflict:${input.id}`)
      return existing
    }
    if (!(await this.getContext({ id: input.contextId }))) throw new Error("context_not_found")
    if (!(await this.getEvent(input.triggerId))) throw new Error("context_session_trigger_not_found")
    if (input.parentSessionId && !(await this.getSession(input.parentSessionId))) {
      throw new Error("context_session_parent_not_found")
    }

    const createdAt = input.createdAt ?? new Date()
    let sessionTx = this.db.tx.context_sessions[input.id]
      .create({
        definition: input.definition,
        status: "running",
        ...(input.sandboxId ? { sandboxId: input.sandboxId } : {}),
        ...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
        createdAt,
      })
      .link({
        context: input.contextId,
        trigger: input.triggerId,
        rootReaction: input.rootReactionId,
        ...(input.parentSessionId ? { parent: input.parentSessionId } : {}),
      })
    const rootReactionTx = this.db.tx.context_reactions[input.rootReactionId]
      .create({
        type: input.definition,
        status: "running",
        position: 0,
        depth: 0,
        causeIds: [input.triggerId],
        effectIds: [],
        createdAt,
      })
      .link({
        session: input.id,
        causes: [input.triggerId],
      })
    const currentSessionTx = this.db.tx.context_contexts[input.contextId]
      .link({ currentSession: input.id })
    try {
      await this.db.transact([sessionTx, rootReactionTx, currentSessionTx])
    } catch (error) {
      const raced = await this.getSession(input.id)
      if (!raced) throw error
      return raced
    }
    return (await this.getSession(input.id))!
  }

  async completeSession(
    sessionId: string,
    status: Exclude<SessionStatus, "running">,
    error?: unknown,
  ) {
    const current = await this.getSession(sessionId)
    if (!current) throw new Error(`context_session_not_found:${sessionId}`)
    if (current.status !== "running") {
      if (current.status !== status || !same(current.error, plainError(error))) {
        throw new Error(`context_session_terminal_conflict:${sessionId}`)
      }
      return
    }
    await this.db.transact([
      this.db.tx.context_sessions[sessionId].update({
        status,
        updatedAt: new Date(),
        ...(error === undefined ? {} : { error: plainError(error) }),
      }),
    ])
  }

  private async reactionRow(reactionId: string) {
    const result = await this.db.query({
      context_reactions: {
        $: { where: { id: reactionId }, limit: 1 },
        session: {},
        parent: {},
        causes: {},
        effects: {},
      },
    } as any)
    return result?.context_reactions?.[0] ?? null
  }

  async getReaction(reactionId: string) {
    const row = await this.reactionRow(reactionId)
    return row ? toReaction(row) : null
  }

  async openReaction(input: Parameters<ContextStore["openReaction"]>[0]) {
    const existing = await this.getReaction(input.id)
    if (existing) {
      const expected = {
        sessionId: input.sessionId,
        type: input.type,
        position: input.position,
        depth: input.depth,
        causeIds: [...input.causeIds],
        parentReactionId: input.parentReactionId,
        instruction: input.instruction,
      }
      const actual = {
        sessionId: existing.sessionId,
        type: existing.type,
        position: existing.position,
        depth: existing.depth,
        causeIds: [...existing.causeIds],
        parentReactionId: existing.parentReactionId,
        instruction: existing.instruction,
      }
      if (!same(actual, expected)) throw new Error(`context_reaction_conflict:${input.id}`)
      return existing
    }
    const session = await this.getSession(input.sessionId)
    if (!session) throw new Error("context_reaction_session_not_found")
    for (const causeId of input.causeIds) {
      if (!(await this.getEvent(causeId))) throw new Error(`context_reaction_cause_not_found:${causeId}`)
    }
    if (input.parentReactionId) {
      const parent = await this.getReaction(input.parentReactionId)
      if (!parent) throw new Error("context_reaction_parent_not_found")
      if (parent.sessionId !== input.sessionId) {
        throw new Error("context_reaction_parent_session_mismatch")
      }
    }
    const createdAt = input.createdAt ?? new Date()
    let tx = this.db.tx.context_reactions[input.id]
      .create({
        type: input.type,
        status: "running",
        position: input.position,
        depth: input.depth,
        causeIds: [...input.causeIds],
        effectIds: [],
        ...(input.instruction ? { instruction: input.instruction } : {}),
        createdAt,
      })
      .link({
        session: input.sessionId,
        causes: [...input.causeIds],
        ...(input.parentReactionId ? { parent: input.parentReactionId } : {}),
      })
    try {
      await this.db.transact([tx])
    } catch (error) {
      const raced = await this.getReaction(input.id)
      if (!raced) throw error
      return raced
    }
    return (await this.getReaction(input.id))!
  }

  async completeReaction(
    reactionId: string,
    status: Exclude<ReactionStatus, "running">,
    effectIds: readonly string[] = [],
    error?: unknown,
  ) {
    const current = await this.getReaction(reactionId)
    if (!current) {
      throw new Error(`context_reaction_not_found:${reactionId}`)
    }
    for (const effectId of effectIds) {
      if (!(await this.getEvent(effectId))) throw new Error(`context_reaction_effect_not_found:${effectId}`)
    }
    if (current.status !== "running") {
      if (
        current.status !== status ||
        !same(current.effectIds, [...effectIds]) ||
        !same(current.error, plainError(error))
      ) {
        throw new Error(`context_reaction_terminal_conflict:${reactionId}`)
      }
      return
    }
    let tx = this.db.tx.context_reactions[reactionId].update({
      status,
      effectIds: [...effectIds],
      updatedAt: new Date(),
      ...(error === undefined ? {} : { error: plainError(error) }),
    })
    if (effectIds.length > 0) tx = tx.link({ effects: [...effectIds] })
    await this.db.transact([tx])
  }
}

export function createInstantStoreRuntime(db: any) {
  return { db, store: new InstantStore(db) }
}

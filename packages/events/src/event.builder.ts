import type { ContextPartEnvelope, ContextInlineContent } from "./context.parts.js"
import { contextPartEnvelopeSchema } from "./context.parts.js"
import type { ContextRuntimeServiceHandle } from "./context.runtime.js"
import { getContextRuntimeServices } from "./context.runtime.js"
import type {
  ContextEvent,
  ContextEventPart,
  SaveContextEventInput,
} from "./context.store.js"
import {
  emitDomainEvent,
  type DomainEventDraftLike,
  type DomainEventEnvelope,
  type DomainEventPhysicalLink,
} from "./domain-event.js"

export type EventCreateInput<Payload = unknown> = Readonly<{
  id?: string
  type: string
  domain?: string
  name?: string
  channel?: string
  payload?: Payload
  links?: Readonly<Record<string, string | readonly string[]>>
  physicalLinks?: Readonly<Record<string, DomainEventPhysicalLink>>
  metadata?: Readonly<Record<string, unknown>>
  parts?: readonly ContextPartEnvelope[]
  contextId?: string
  createdAt?: string | Date
}>

/** The InstaQL selection nested below `context_events`. */
export type EventQueryInput = Readonly<Record<string, unknown>>
export type EventQueryResult<Event extends ContextEvent = ContextEvent> = readonly Event[]

function normalizeDate(value: string | Date | undefined) {
  const result = value instanceof Date ? value : value ? new Date(value) : new Date()
  if (Number.isNaN(result.valueOf())) throw new Error("events_invalid_createdAt")
  return result
}

function normalizePart(row: any): ContextEventPart {
  return Object.freeze({
    id: String(row.id),
    key: String(row.key),
    index: Number(row.index),
    type: String(row.type),
    content: row.content,
    ...(row.metadata == null ? {} : { metadata: Object.freeze({ ...row.metadata }) }),
    createdAt: normalizeDate(row.createdAt),
    ...(row.updatedAt == null ? {} : { updatedAt: normalizeDate(row.updatedAt) }),
  })
}

function normalizeQueriedEvent(row: any): ContextEvent {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("events_query_returned_invalid_event")
  }
  return Object.freeze({
    id: String(row.id),
    type: String(row.type),
    createdAt: normalizeDate(row.createdAt),
    ...(typeof row.domain === "string" ? { domain: row.domain } : {}),
    ...(typeof row.name === "string" ? { name: row.name } : {}),
    ...(typeof row.channel === "string" ? { channel: row.channel } : {}),
    payload: row.payload,
    links: Object.freeze({ ...(row.links ?? {}) }),
    physicalLinks: Object.freeze({ ...(row.physicalLinks ?? {}) }),
    metadata: Object.freeze({ ...(row.metadata ?? {}) }),
    eventParts: Object.freeze(
      [...(row.eventParts ?? [])]
        .sort((left, right) => Number(left.index) - Number(right.index))
        .map(normalizePart),
    ),
  })
}

export class Part {
  static new(part: ContextPartEnvelope): ContextPartEnvelope {
    return contextPartEnvelopeSchema.parse(part)
  }

  static message(input: string | { text?: string; blocks?: ContextInlineContent[] }) {
    return Part.new({
      type: "message",
      content: typeof input === "string" ? { text: input } : input,
    })
  }

  static file(input: {
    mediaType: string
    filename?: string
    data?: string
    url?: string
    fileId?: string
  }) {
    return Part.message({ blocks: [{ type: "file", ...input }] })
  }

  static json(value: unknown) {
    return Part.message({ blocks: [{ type: "json", value }] })
  }
}

export class EventBuilder<Payload = unknown> {
  private readonly parts: ContextPartEnvelope[] = []

  constructor(
    private readonly runtime: ContextRuntimeServiceHandle,
    private readonly input: EventCreateInput<Payload>,
  ) {}

  part(part: ContextPartEnvelope) {
    this.parts.push(Part.new(part))
    return this
  }

  async create() {
    return await new EventsClient(this.runtime).create({
      ...this.input,
      parts: [...(this.input.parts ?? []), ...this.parts],
    })
  }
}

export class EventsClient {
  constructor(private readonly runtime: ContextRuntimeServiceHandle) {}

  async create<Payload>(input: EventCreateInput<Payload>): Promise<ContextEvent<Payload>> {
    if (!input.type?.trim()) throw new Error("events_type_required")
    const { store } = await getContextRuntimeServices(this.runtime)
    const existing = input.id && input.createdAt === undefined
      ? await store.getEvent(input.id)
      : null
    const event: SaveContextEventInput<Payload> = {
      id: input.id ?? globalThis.crypto.randomUUID(),
      type: input.type.trim(),
      createdAt: existing?.createdAt ?? normalizeDate(input.createdAt),
      ...(input.domain ? { domain: input.domain } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
      payload: input.payload as Payload,
      links: Object.freeze({ ...(input.links ?? {}) }),
      physicalLinks: Object.freeze({ ...(input.physicalLinks ?? {}) }),
      metadata: Object.freeze({ ...(input.metadata ?? {}) }),
      eventParts: (input.parts ?? []).map((part, index) => ({
        index,
        type: part.type,
        content: part.content,
        ...(part.reactorMetadata
          ? { metadata: part.reactorMetadata as Readonly<Record<string, unknown>> }
          : {}),
      })),
    }
    return await store.saveEvent(event, input.contextId ? { id: input.contextId } : undefined)
  }

  async emit<Payload>(
    draft: DomainEventDraftLike<Payload>,
    envelope: DomainEventEnvelope = {},
  ) {
    return await emitDomainEvent(this.runtime, draft, envelope)
  }

  async query<Event extends ContextEvent = ContextEvent>(
    input: EventQueryInput,
  ): Promise<EventQueryResult<Event>> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("events_query_requires_object")
    }
    const { db } = await getContextRuntimeServices(this.runtime)
    const query = {
      ...input,
      eventParts: (input as any).eventParts ?? { $: { order: { index: "asc" } } },
    }
    const result = await db.query({ context_events: query } as any)
    return Object.freeze(
      (Array.isArray(result?.context_events) ? result.context_events : [])
        .map(normalizeQueriedEvent) as Event[],
    )
  }

  builder<Payload>(input: EventCreateInput<Payload>) {
    return new EventBuilder(this.runtime, input)
  }
}

export function Events(runtime: ContextRuntimeServiceHandle) {
  return new EventsClient(runtime)
}

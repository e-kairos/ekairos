import type { ContextPartEnvelope } from "./context.parts.js"
import type { ContextRuntimeServiceHandle } from "./context.runtime.js"
import { getContextRuntimeServices } from "./context.runtime.js"
import type { DomainEventItem } from "./context.store.js"

export type DomainEventPhysicalLink = Readonly<{
  alias: string
  key: string
  target: string
  has: "one" | "many"
  forwardLabel: string
  reverseLabel: string
}>

export type DomainEventDraftLike<Payload = unknown> = Readonly<{
  payload: Payload
  links: Readonly<Partial<Record<string, string | readonly string[]>>>
  kind: string
  domain: string
  name: string
  physicalLinks: Readonly<Record<string, DomainEventPhysicalLink>>
}>

export type DomainEventEnvelope = Readonly<{
  id?: string
  channel?: string
  createdAt?: string | Date
  contextId?: string
  metadata?: Readonly<Record<string, unknown>>
  parts?: readonly ContextPartEnvelope[]
}>

function required(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`invalid_domain_event_${label}`)
  }
}

function createdAt(value: DomainEventEnvelope["createdAt"]): Date {
  const result = value instanceof Date ? value : value ? new Date(value) : new Date()
  if (Number.isNaN(result.valueOf())) throw new Error("invalid_domain_event_createdAt")
  return result
}

function validateLinks(draft: DomainEventDraftLike) {
  for (const [alias, value] of Object.entries(draft.links ?? {})) {
    const mapping = draft.physicalLinks[alias]
    if (!mapping || mapping.alias !== alias) {
      throw new Error(`domain_event_link_mapping_missing:${draft.kind}:${alias}`)
    }
    const valid = mapping.has === "one"
      ? typeof value === "string"
      : typeof value === "string" || (
          Array.isArray(value) && value.every(reference => typeof reference === "string")
        )
    if (!valid) throw new Error(`domain_event_link_cardinality:${draft.kind}:${alias}`)
  }
}

export async function emitDomainEvent<Payload>(
  runtime: ContextRuntimeServiceHandle,
  draft: DomainEventDraftLike<Payload>,
  envelope: DomainEventEnvelope = {},
): Promise<DomainEventItem<Payload>> {
  if (!draft || typeof draft !== "object") throw new Error("invalid_domain_event_draft")
  required(draft.domain, "domain")
  required(draft.name, "name")
  required(draft.kind, "type")
  validateLinks(draft)

  const { store } = await getContextRuntimeServices(runtime)
  const id = envelope.id ?? globalThis.crypto.randomUUID()
  const existing = envelope.id && envelope.createdAt === undefined
    ? await store.getEvent(envelope.id)
    : null
  const event = await store.saveEvent({
    id,
    type: draft.kind,
    domain: draft.domain,
    name: draft.name,
    ...(envelope.channel ? { channel: envelope.channel } : {}),
    payload: draft.payload,
    links: Object.freeze({ ...(draft.links ?? {}) }) as Readonly<
      Record<string, string | readonly string[]>
    >,
    physicalLinks: Object.freeze({ ...(draft.physicalLinks ?? {}) }),
    metadata: Object.freeze({ ...(envelope.metadata ?? {}) }),
    createdAt: existing?.createdAt ?? createdAt(envelope.createdAt),
    eventParts: (envelope.parts ?? []).map((part, index) => ({
      index,
      type: part.type,
      content: part.content,
      ...(part.reactorMetadata
        ? { metadata: part.reactorMetadata as Readonly<Record<string, unknown>> }
        : {}),
    })),
  }, envelope.contextId ? { id: envelope.contextId } : undefined)

  return event as DomainEventItem<Payload>
}

export function isDomainEventItem(value: unknown): value is DomainEventItem {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as any).domain === "string" &&
      typeof (value as any).name === "string" &&
      typeof (value as any).type === "string",
  )
}

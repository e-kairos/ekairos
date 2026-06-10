import { i } from "@instantdb/core";
import { domain, type DomainSchemaResult } from "@ekairos/domain";
import { eventsDomain } from "@ekairos/events/schema";

/**
 * Channel domain: one canonical message entity for every communication
 * channel (web, email, whatsapp, ...). Provider-specific records (a Resend
 * email, a Twilio message) stay in app/provider domains and link back to
 * channel_messages via `externalId`/`raw`.
 *
 * Generalized from the esolbay-platform conversation domain.
 */
const entities = {
  channel_messages: i.entity({
    channel: i.string().indexed(),
    direction: i.string().indexed(),
    role: i.string().optional().indexed(),
    text: i.string().optional(),
    parts: i.json().optional(),
    status: i.string().optional().indexed(),
    externalId: i.string().optional().indexed(),
    participant: i.string().optional().indexed(),
    raw: i.json().optional(),
    createdAt: i.date().indexed(),
    updatedAt: i.date().optional(),
  }),
  // Internal runtime state for platform delivery (subscriptions, locks,
  // caches, queues). Owned by the channel domain so the whole channel stack
  // persists on InstantDB — consumers never touch these entities directly.
  channel_state: i.entity({
    key: i.string().unique().indexed(),
    value: i.json().optional(),
    expiresAt: i.date().optional().indexed(),
    updatedAt: i.date(),
  }),
  channel_locks: i.entity({
    threadId: i.string().unique().indexed(),
    token: i.string(),
    expiresAt: i.date().indexed(),
  }),
  channel_subscriptions: i.entity({
    threadId: i.string().unique().indexed(),
    createdAt: i.date(),
  }),
  channel_queues: i.entity({
    threadId: i.string().indexed(),
    seq: i.number().indexed(),
    entry: i.json(),
    createdAt: i.date(),
  }),
} as const;

const links = {
  channel_messagesContext: {
    forward: { on: "channel_messages", has: "one", label: "context" },
    reverse: { on: "event_contexts", has: "many", label: "channelMessages" },
  },
  channel_messagesItem: {
    forward: { on: "channel_messages", has: "one", label: "item" },
    reverse: { on: "event_items", has: "many", label: "channelMessages" },
  },
} as const;

const rooms = {} as const;

export const channelDomain = domain("channel")
  .includes(eventsDomain)
  .withSchema({
    entities,
    links,
    rooms,
  }) as unknown as DomainSchemaResult<
    typeof entities,
    typeof links,
    typeof rooms,
    {},
    "channel",
    "channel"
  >;

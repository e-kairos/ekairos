import { i } from "@instantdb/core";
import { domain } from "@ekairos/domain";
import { contextDomain } from "@ekairos/events/schema";

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
  // Per-channel extensions: the full truth of what happened on the wire,
  // one row per channel_message of that kind. The event stays canonical for
  // the agent; these carry the channel-specific facts (esolbay's
  // email_emails → event pattern, generalized).
  channel_emails: i.entity({
    subject: i.string().optional().indexed(),
    fromAddress: i.string().optional().indexed(),
    toAddress: i.string().optional().indexed(),
    cc: i.json().optional(),
    messageId: i.string().optional().indexed(),
    inReplyTo: i.string().optional().indexed(),
    provider: i.string().optional(),
    createdAt: i.date().optional().indexed(),
  }),
  channel_whatsapp: i.entity({
    messageSid: i.string().optional().indexed(),
    profileName: i.string().optional(),
    waId: i.string().optional().indexed(),
    mediaCount: i.number().optional(),
    provider: i.string().optional(),
    createdAt: i.date().optional().indexed(),
  }),
  // Conversation-level state that lives BEFORE the agent: which award/tender
  // a phone/email participant is talking about, pending selections, etc.
  // (esolbay's conversation_sessions, generalized.)
  channel_sessions: i.entity({
    channel: i.string().indexed(),
    participant: i.string().indexed(),
    state: i.string().optional().indexed(),
    data: i.json().optional(),
    contextId: i.string().optional().indexed(),
    createdAt: i.date().optional().indexed(),
    updatedAt: i.date().optional(),
    closedAt: i.date().optional(),
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
  channelMessagesContext: {
    forward: { on: "channel_messages", has: "one", label: "context" },
    reverse: { on: "context_contexts", has: "many", label: "channelMessages" },
  },
  channelMessagesEvent: {
    forward: { on: "channel_messages", has: "one", label: "event" },
    reverse: { on: "context_events", has: "many", label: "channelMessages" },
  },
  channel_emailsMessage: {
    forward: { on: "channel_emails", has: "one", label: "message" },
    reverse: { on: "channel_messages", has: "one", label: "email" },
  },
  channel_emailsAttachments: {
    forward: { on: "channel_emails", has: "many", label: "attachments" },
    reverse: { on: "$files", has: "one", label: "channelEmail" },
  },
  channel_whatsappMessage: {
    forward: { on: "channel_whatsapp", has: "one", label: "message" },
    reverse: { on: "channel_messages", has: "one", label: "whatsapp" },
  },
} as const;

const rooms = {} as const;

export const channelDomain = domain("channel")
  .includes(contextDomain)
  .withSchema({
    entities,
    links,
    rooms,
  });

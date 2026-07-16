# Channel Domain

Module: `@ekairos/channel`

Canonical domain: `channelDomain`

## Ownership

- `channel_messages`: normalized communication across transports
- `channel_emails` and `channel_whatsapp`: provider-specific wire facts
- `channel_sessions`: participant routing state before a Reaction
- internal delivery state, locks, subscriptions, and queues
- links from messages to Contexts, Events, attachments, and transport records

## Invariants

1. Provider payloads are normalized once into `channel_messages`.
2. Attachments stay as `$files` links.
3. A bound Reaction receives the persisted domain Event and Context; Channel
   does not implement a second agent runner.
4. Delivery state is internal to Channel and is not application business state.
5. Application domains own the Event constructor and Reaction definition.

# @ekairos/events

`@ekairos/events` persists typed facts and the causal journal used by Ekairos.
It does not execute models.

## Domain composition

```ts
import { domain } from "@ekairos/domain"
import { contextDomain } from "@ekairos/events"

export const appDomain = domain("app")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
```

## Emit a domain Event

```ts
const received = await Events(runtime).emit(
  requisition.events.messageReceived({
    message: "Quote the attached requisition.",
  }).link({
    requisition: requisitionId,
    files: fileIds,
  }),
  {
    id: crypto.randomUUID(),
    channel: "email",
    contextId,
    createdAt: new Date(),
    metadata: { receivedAt: new Date().toISOString() },
  },
)
```

The Event stores its payload, logical links, generated physical InstantDB links,
metadata, and optional ordered Parts. Linked `$files` remain relations; they are
not copied into Context content.

## Query explicit history

`Events.query` accepts the selection nested under `context_events`:

```ts
const history = await Events(runtime).query({
  $: {
    where: {
      "context.id": contextId,
      domain: "requisition",
    },
    order: { createdAt: "asc" },
  },
})
```

History is never loaded implicitly. Pass the selected Events to
`reaction.given(history)` when they should become causal model input.

## Event Parts

```ts
const event = await Events(runtime)
  .builder({
    type: "message.received",
    payload: { message: "Inspect this file." },
    contextId,
  })
  .part(Part.message("Inspect this file."))
  .part(Part.file({ fileId, filename: "offer.pdf", mediaType: "application/pdf" }))
  .create()
```

Parts use provider-neutral types: `message`, `reasoning`, `source`, `action`,
and `engine`. Action calls persist separate started/completed/failed Parts.

## Durable graph

```text
Context
  Session
    trigger -> Event
    rootReaction -> Reaction
    reactions -> Reaction*

Reaction
  causes -> Event*
  effects -> Event*

Event
  eventParts -> EventPart*
```

The root package exports Event builders, Context handles, the Context domain,
Parts, React subscriptions, and runtime service contracts.

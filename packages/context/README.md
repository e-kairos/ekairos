# @ekairos/context

`@ekairos/context` combines durable Context handles, typed Events, and Reaction
execution without adding a second persistence model.

## Create and revise Context data

```ts
const context = await Context(runtime).create({
  key: "requisition:REQ-42",
  content: {
    requisition: { id: "REQ-42", version: 7 },
  },
})

const current = await context.updateContent({
  requisition: { id: "REQ-42", version: 8 },
})
```

The next Reaction sees version 8 at `reaction.context.content` and version 7 at
`reaction.context.previous`.

## Emit and react

```ts
const trigger = await Context(runtime).events.emit(
  requisition.events.messageReceived({
    message: "Quote the attachments.",
  }).link({
    requisition: "REQ-42",
    files: fileIds,
  }),
  {
    channel: "email",
    contextId: current.id,
  },
)

const response = await current.react(trigger, messageReaction)
console.log(response.payload)
```

The Event exists independently from the Reaction. The same Event can trigger
different definitions or react in different Contexts.

## React from a domain action

Reactor passes only the durable `reactionId` to an action. Resolve the owning
Context explicitly; no Reaction methods or runtime callbacks travel into the
action.

```ts
execute: async ({ input, runtime, reactionId }) => {
  if (!reactionId) throw new Error("review_reaction_required")

  const context = await Context(runtime).fromReaction(reactionId)
  const requested = await context.emit(
    reviews.events.verificationRequested({ reviewId: input.reviewId }),
    { key: `verification-requested:${input.reviewId}` },
  )

  return await context.react(requested, verifyReview)
}
```

The emission is an effect of the originating Reaction. The nested call opens a
child Session in the same Context. `key` makes the emitted Event idempotent
across Workflow retries.

## Runtime conveniences

```ts
const contexts = Context(runtime)

await contexts.create({ key, content })
await contexts.get({ key })
await contexts.fromReaction(reactionId)
await contexts.events.emit(draft, envelope)
await contexts.use(requisitionDomain)
```

Reaction definitions and engines live in `@ekairos/reactor`; persistence lives
in `@ekairos/events`.

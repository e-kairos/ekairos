# Ekairos Base Domain Map

Ekairos Base is a domain-first monorepo. Applications compose the domains they
need into one root domain and provide an explicit `EkairosRuntime` for that
composition.

## Core domains

- `@ekairos/domain` defines bounded contexts, InstantDB schemas, typed Events,
  domain actions, and runtime scoping.
- `@ekairos/events` owns `contextDomain`: Contexts, Sessions, Events, Reactions,
  and Event Parts.
- `@ekairos/context` is the application-facing Context handle. It owns no
  second schema.
- `@ekairos/dataset` owns durable typed Datasets and records.
- `@ekairos/channel` owns normalized communication and transport facts.
- `@ekairos/evals` owns evaluation runs and results linked to Context Sessions.

`@ekairos/reactor` is orchestration over those domains. It owns no persistence
schema.

## Causal model

1. A domain Event is an immutable fact.
2. A Context owns durable `content` and an ordered Event timeline. An exogenous
   Event appended to the Context records the previous timeline head in
   `metadata.causeIds`.
3. A Session is one flat configured execution in one Context. It is persisted
   lazily by its first operation with definition `"session"`.
4. A Reaction links one or more cause Events to one or more effect Events.
5. Every observable operation is represented by a child Reaction. Most
   operations produce one effect Event; `agent` records every model round and
   executed action as ordered effect Events of that same Reaction. There are no
   Steps, Points, or Executions.
6. A Reaction owns zero or one provisional InstantDB stream. Each event-scoped
   stream entry carries the deterministic effect Event id it projects. Durable
   Events replace their provisional projections independently as they complete.
7. Event Parts are the ordered, streamable content of an Event: messages,
   reasoning, sources, actions, and structured values.
8. `session.from(event)` selects the Event and its causal ancestry as material
   and records the selected point as the operation Reaction cause. An Event
   array is the explicit fan-in form.
9. `agent`, `action`, `dataset`, `loadFiles`, `storeFiles`, `shell`, and `git`
   return Events. Later operations consume those Events.
10. Reactor passes the Session execution environment to domain actions as
    `{ context: { id, key }, sessionId, reactionId, causeIds }`. Action input
    contains only domain data that cannot be inferred from that environment.

## Composition

```ts
export const appDomain = domain("app")
  .includes(contextDomain)
  .includes(channelDomain)
  .includes(datasetDomain)
  .includes(requisitionDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withActions(datasetDomain.actions)
```

Meaningful writes execute through registered domain actions. APIs, workflows,
CLIs, imports, and UIs are adapters over the composed runtime.

Files remain Event links until explicitly materialized in a Reaction workspace.
Engines and sandboxes are declared by each Reaction and never stored in Context
content.

## Canonical durable coaching flow

```ts
const publishReview = defineAction({
  input: z.object({ review: coachingSchema }),
  output: z.object({ reviewId: z.string() }),
  async execute({ input, domain }, executionContext) {
    "use step"
    if (!executionContext) throw new Error("session_execution_context_required")
    return await publishCoachingReview(domain.db, {
      contextKey: executionContext.context.key,
      review: input.review,
    })
  },
})

export const rocket = domain("rocket")
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({ messageReceived })
  .withActions({ publishReview })

const coaching = rocket.scope({
  events: [rocket.events.messageReceived],
  actions: [rocket.actions.publishReview],
})

export async function coachMatch(
  runtime: RocketRuntime,
  matchId: string,
  text: string,
) {
  "use workflow"

  await using session = await Context(runtime).session(
    `rocket:${matchId}`,
    coaching,
    ai({ model: "anthropic/claude-haiku-4.5" }),
    { sandbox: false },
  )
  const triage = await session
    .from(rocket.events.messageReceived({ text }))
    .agent({
      instruction: "Choose the relevant replay windows.",
      output: triageSchema,
      datasets: false,
    })
  const final = await session.from(triage).agent({
    instruction: "Synthesize one coaching paragraph and two priorities.",
    output: coachingSchema,
    datasets: false,
  })
  return await session.from(final).action(
    rocket.actions.publishReview,
    { review: final.payload },
  )
}
```

`"use workflow"` is the flagship durable form. Scripts and tests may run the
same orchestration without the directive.

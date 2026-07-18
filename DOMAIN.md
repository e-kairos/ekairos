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
2. A Context is pure durable data: `content` and its optional `previous`
   revision.
3. A Session is one invocation of a Reaction definition in one Context.
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
8. `reaction.given(event)` selects explicit causal input. An Event array is the
   explicit fan-in form.
9. `agent`, `action`, `dataset`, `workspace`, `shell`, `git`, and `emit` all
   return Events. Later operations consume those Events.
10. Reactor passes only the invoking `reactionId` into a domain action. An
    action resolves the owning Context explicitly when it must emit an effect
    or start a child Reaction; executable Reactor capabilities never enter the
    action contract.

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

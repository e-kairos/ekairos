# Context Domain

Module: `@ekairos/events`

Canonical domain: `contextDomain`

## Ownership

`contextDomain` owns exactly five durable entities:

- `context_contexts`: durable Context identity and content
- `context_sessions`: one flat execution in a Context
- `context_events`: exogenous facts and operation results
- `context_reactions`: causal links from cause Events to effect Events
- `context_eventParts`: ordered content attached to an Event

The schema and links remain unchanged by the flat Session API.

## Context handle

```ts
const context = await ContextHandle.open(runtime, { key, content })
const event = await context.append(domainEvent)
const timeline = await context.events
const state = context.content
```

`append` persists a typed domain Event in the Context. It records the previous
timeline head in `event.metadata.causeIds`; the first appended Event stores an
empty array. This gives exogenous Events a Git-like parent without adding a new
schema field.

## Invariants

1. Event constructors create immutable drafts and never write.
2. `ContextHandle.open(...)` gets or creates durable Context identity by id or
   key and may set its durable content.
3. `ContextHandle.append(...)` is the application-facing entry for exogenous
   domain facts.
4. `context.events` reads the complete Context timeline in ascending creation
   order. There are no checkpoints yet.
5. A Session belongs to one Context, has one trigger Event, and has one root
   Reaction.
6. Every operation Reaction belongs to one Session and stores ordered
   `causeIds` and `effectIds` plus the existing InstantDB links.
7. A Reaction has zero or one linked `$stream`. The stream remains a resumable,
   provisional journal, never the durable result.
8. Event Parts are ordered by `index` and remain the canonical UI/model trace.
9. Reaction-produced causal ancestry is read from the producer Reaction.
   Exogenous ancestry is read from `event.metadata.causeIds`.
10. Context content contains no implicit files, workspace, engine, sandbox,
    actions, or tool state.

Reaction execution and model projection belong to `@ekairos/reactor`.

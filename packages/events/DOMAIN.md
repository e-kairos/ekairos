# Context Domain

Module: `@ekairos/events`

Canonical domain: `contextDomain`

## Ownership

`contextDomain` owns exactly five durable entities:

- `context_contexts`: pure Context content and its previous revision
- `context_sessions`: one Reaction-definition invocation
- `context_events`: domain facts and operation results
- `context_reactions`: causal links from cause Events to effect Events
- `context_eventParts`: ordered content attached to an Event

## Invariants

1. Event constructors create immutable drafts and never write.
2. `Events(runtime).emit(...)` validates and persists a typed domain Event.
3. `Events(runtime).create(...)` is reserved for provider-neutral technical
   Events created by infrastructure.
4. A Session belongs to one Context, has one trigger Event, and has one root
   Reaction.
5. Every Reaction belongs to one Session and stores ordered cause/effect ids in
   addition to real InstantDB links.
6. Event Parts are ordered by `index` and are the canonical UI/model trace.
7. Context content contains no implicit files, workspace, engine, sandbox, or
   tool state.

Reaction execution and model projection belong to `@ekairos/reactor`.

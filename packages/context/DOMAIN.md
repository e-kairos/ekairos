# Context Boundary

Module: `@ekairos/context`

`@ekairos/context` owns no schema. It provides the application-facing
`ReactionContextHandle` over `contextDomain`.

## Invariants

- Context is pure durable data with `content` and optional `previous` content.
- `create({ key, content })` is idempotent by key.
- `updateContent` replaces content and preserves the replaced revision.
- Event emission is explicit through `Events(runtime)` or
  `Context(runtime).events`.
- Reaction execution is explicit through `context.react(trigger, definition)`.
- A caller may place that same call inside an explicit `"use workflow"`
  function; Context never creates a Workflow implicitly.
- `Context(runtime).fromReaction(reactionId)` binds one existing Reaction to its
  Context without transporting executable capabilities into a domain action.
- A bound Context may emit deterministic effects and start child Reactions; the
  parent Session and Reaction are resolved from that single durable id.
- Files, repositories, Datasets, engines, sandboxes, and tools are not Context
  fields.
- Meaningful writes remain registered domain actions.

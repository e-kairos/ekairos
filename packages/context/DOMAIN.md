# Context Boundary

Module: `@ekairos/context`

`@ekairos/context` owns no schema. It integrates the durable Events handle with
the flat Reactor Session.

```ts
const coaching = appDomain.scope({
  events: [appDomain.events.messageReceived],
  actions: [appDomain.actions.saveAnswer],
})
await using session = await Context(runtime).session(
  key,
  coaching,
  engine,
  { sandbox: false },
)
const answer = await session.from(
  appDomain.events.messageReceived(payload),
).agent({
  instruction,
  output,
  actions: [appDomain.actions.saveAnswer],
})
```

## Invariants

- `Context(runtime).open(contextKey)` opens only the durable timeline handle.
- `Context(runtime).session(contextKey, scope, engine, options)` is the
  execution entry.
- Context owns durable content and the complete Event timeline.
- Drafts passed to `from(...)` are appended before execution.
- Session configuration contains only `scope`, `engine`, and optional
  `sandbox`.
- `session.context` exposes the opened timeline handle.
- Agent actions are explicit per operation.
- `from(...)` selects both causal points and their complete material cones.
- Session operations write directly to the Context timeline.
- Async disposal is canonical; `complete()` is optional and idempotent.
- Dispatch and subscriptions are outside this package.

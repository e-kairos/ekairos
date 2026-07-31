# Context Boundary

Module: `@ekairos/context`

`@ekairos/context` owns no schema. It integrates the durable Events handle with
the flat Reactor Session.

```ts
const context = await Context(runtime).open({ key, content })
const message = await context.append(appDomain.events.messageReceived(payload))
const session = context.session({ scope: appDomain, engine, sandbox: false })
const answer = await session.from(message).agent({
  instruction,
  output,
  actions: [appDomain.actions.saveAnswer],
})
await session.complete()
```

## Invariants

- `Context(runtime).open(...)` is the only application-facing Context entry.
- Context owns durable content and the complete Event timeline.
- Exogenous facts enter through `context.append(...)`.
- Session configuration contains only `scope`, `engine`, and optional
  `sandbox`.
- Agent actions are explicit per operation.
- `from(...)` selects both causal points and their complete material cones.
- Session operations write directly to the Context timeline.
- `complete()` returns nothing; effects are already persisted Events.
- Dispatch and subscriptions are outside this package.

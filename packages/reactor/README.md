# @ekairos/reactor

Flat, causal execution over durable Ekairos Context Events.

Reactor owns no persistence schema. `@ekairos/events` stores Contexts,
Sessions, Reactions, Events, Parts, and streams.

## Surface

```ts
import { Session, ai } from "@ekairos/reactor"
```

Applications normally construct a Session through `@ekairos/context`:

```ts
const answering = app.scope({
  events: [app.events.messageReceived],
  actions: [app.actions.saveDecision],
})
await using session = await Context(runtime).session(
  key,
  answering,
  ai({ model: "openai/gpt-5.2" }),
  { sandbox: false },
)
const message = app.events.messageReceived(payload)
```

The concrete scope is the execution boundary for domain Events and actions.
Actions are still exposed explicitly to each Agent operation.

## Operations

```ts
const analysis = await session.from(message).agent({
  instruction: "Analyze the request.",
  output: analysisSchema,
  actions: [app.actions.lookupAccount],
})

const [items, risks] = await Promise.all([
  session.from(analysis).agent({
    instruction: "Extract the items.",
    output: itemsSchema,
  }),
  session.from(analysis).dataset({
    instruction: "Build one row per risk.",
    schema: riskSchema,
  }),
])

const decision = await session.from([items, risks]).agent({
  instruction: "Decide using both causal cones.",
  output: decisionSchema,
  datasets: false,
})

const saved = await session.from(decision).action(
  app.actions.saveDecision,
  decision.payload,
)
```

`from(event)` supplies the Event and its complete causal ancestry. A domain
Event draft is appended to `session.context` first, then its persisted Event is
used as the point.
`from([a, b])` supplies the ordered union of both cones. The operation Reaction
stores the passed Event ids exactly as its `causeIds`.

Available operations:

- `agent`
- `dataset`
- `action`
- `loadFiles`
- `storeFiles`
- `shell`
- `git`

Every operation returns its last persisted `ContextEvent`. Agent execution may
record multiple ordered effect Events for rounds and action calls.

`agent` enables the Dataset capability by default. Use `datasets: false` to
turn it off. Agent actions are explicit in that operation's `actions` array.

## Completion and failure

`await using` is canonical. Clean disposal calls the idempotent
`complete(): Promise<void>` and records the last operation result as the root
Reaction effect. Explicit `complete()` remains optional. An operation failure
marks the root Reaction and Session failed before the error escapes.

There is no public callback definition, app-facing execution function,
`given`, or Session `emit`.

## Workflow

The same code can run inside an explicit Workflow:

```ts
export async function analyze(runtime: AppRuntime, contextKey: string) {
  "use workflow"

  await using session = await Context(runtime).session(
    contextKey,
    answering,
    engine,
    { sandbox: false },
  )
  return await session.from(app.events.messageReceived(payload)).agent({
    instruction: "Answer.",
    output: answerSchema,
  })
}
```

For direct scripts and tests, use the same code without `"use workflow"`.

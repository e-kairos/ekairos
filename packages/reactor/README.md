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
const context = await Context(runtime).open({ key, content })
const message = await context.append(app.events.messageReceived(payload))
const session = context.session({
  scope: app,
  engine: ai({ model: "openai/gpt-5.2" }),
  sandbox: false,
})
```

The configuration is exactly `scope`, `engine`, and optional `sandbox`.
Actions are never Session defaults.

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

await session.complete()
```

`from(event)` supplies the Event and its complete causal ancestry.
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

`complete(): Promise<void>` completes the Session and records the last
operation result as the root Reaction effect. An operation failure marks the
root Reaction and Session failed and rethrows.

There is no public callback definition, app-facing execution function,
`given`, or Session `emit`.

## Workflow

The same code can run inside an explicit Workflow:

```ts
export async function analyze(context: SessionContextHandle, message: ContextEvent) {
  "use workflow"

  const session = context.session({ scope: app, engine, sandbox: false })
  const answer = await session.from(message).agent({
    instruction: "Answer.",
    output: answerSchema,
  })
  await session.complete()
  return answer
}
```

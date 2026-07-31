# @ekairos/context

Application-facing integration of durable Context Events and flat Reactor
Sessions.

```ts
import { Context } from "@ekairos/context"

const answering = appDomain.scope({
  events: [appDomain.events.messageReceived],
  actions: [appDomain.actions.saveAnswer],
})
await using session = await Context(runtime).session(
  `conversation:${conversationId}`,
  answering,
  engine,
  { sandbox: false },
)
const answer = await session.from(
  appDomain.events.messageReceived({ text }),
).agent({
  instruction: "Answer the message.",
  output: answerSchema,
  actions: [appDomain.actions.saveAnswer],
})
```

Open only the durable timeline when no execution is needed:

```ts
const context = await Context(runtime).open(`conversation:${conversationId}`)
context.content
await context.events
await context.append(appDomain.events.messageReceived({ text }))
```

Exogenous facts use `context.append`. Business state changes use domain
actions. Drafts passed to `session.from(...)` are appended automatically.
`session.context` exposes the same timeline handle. Async disposal completes a
clean Session; explicit `complete()` remains optional and idempotent.

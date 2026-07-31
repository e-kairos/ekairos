# @ekairos/context

Application-facing integration of durable Context Events and flat Reactor
Sessions.

```ts
import { Context } from "@ekairos/context"

const context = await Context(runtime).open({
  key: `conversation:${conversationId}`,
  content: { conversationId },
})

const message = await context.append(
  appDomain.events.messageReceived({ text }),
)

const session = context.session({
  scope: appDomain,
  engine,
  sandbox: false,
})

const answer = await session.from(message).agent({
  instruction: "Answer the message.",
  output: answerSchema,
  actions: [appDomain.actions.saveAnswer],
})

await session.complete()
```

Context owns durable content and its Event timeline:

```ts
context.content
await context.events
```

Exogenous facts use `context.append`. Business state changes use domain
actions. Session configuration contains only `scope`, `engine`, and optional
`sandbox`; Agent actions are explicit per operation.

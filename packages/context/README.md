# @ekairos/context

Typed domain events and workflow-safe reactions.

`@ekairos/context` is the final public entrypoint for the new context framework:

- domains declare typed events with `defineEvent(...)` and `.withEvents(...)`;
- concrete runtimes create events through `domain(runtime).events.*`;
- reactions are declared with `defineReaction(...)`;
- reaction executions append durable steps and parts and finish with an optional typed result.

```ts
import { defineEvent, defineReaction, Part } from "@ekairos/context"

const received = defineEvent({
  payload: z.object({ subject: z.string(), body: z.string() }),
  parts: ({ payload }) => [Part.message({ text: payload.body })],
})

const emailDomain = domain("email")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({ received })

const reaction = defineReaction({
  key: "email.classify",
  scope: emailDomain,
  context: z.object({ inboxId: z.string() }),
  output: z.object({ label: z.string() }),
  run: async ({ execution }) => {
    const classification = await execution.step("classify", {
      instructions: "Classify the email.",
      output: z.object({ label: z.string() }),
    })
    await execution.complete(classification)
  },
})
```

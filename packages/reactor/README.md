# @ekairos/reactor

`@ekairos/reactor` executes typed reactions over durable Contexts. Its
programming model has three durable concepts:

- an Event is a fact or operation result
- a Reaction links cause Events to effect Events
- a Session is one invocation of a Reaction definition in one Context

There are no Steps, Points, or implicit history.

## Define the domain

```ts
import { defineDomainAction, defineEvent, domain } from "@ekairos/domain"
import { contextDomain } from "@ekairos/events"
import { z } from "zod"

export const support = domain("support")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    messageReceived: defineEvent({
      payload: z.object({ message: z.string(), turn: z.number().int() }),
      links: { files: { on: "$files", has: "many" } },
    }),
    responseCreated: defineEvent({
      payload: z.object({ answer: z.string(), turn: z.number().int() }),
    }),
    reviewRequested: defineEvent({
      payload: z.object({ subject: z.string() }),
    }),
    reviewCompleted: defineEvent({
      payload: z.object({ approved: z.boolean(), summary: z.string() }),
    }),
  })
  .withActions({
    recordAnswer: defineDomainAction({
      input: z.object({ accountId: z.string(), answer: z.string() }),
      output: z.object({ accountId: z.string(), answer: z.string() }),
      async execute({ input }) {
        return input
      },
    }),
  })
```

## Define a Reaction

`defineReaction` requires the trigger constructor, domain scope, engine,
sandbox, and handler. Use `false` to disable an unused integration explicitly.

```ts
import { ai, defineReaction } from "@ekairos/reactor"
import { z } from "zod"

type SupportContext = {
  accountId: string
  policyVersion: number
}

export const answerMessage = defineReaction<
  typeof support.events.messageReceived,
  SupportContext,
  typeof support
>(
  support.events.messageReceived,
  {
    key: "support.answer-message",
    scope: support,
    engine: ai({ model: "openai/gpt-5.4" }),
    sandbox: false,
  },
  async reaction => {
    const history = await Events(runtime).query({
      $: {
        where: {
          "context.id": reaction.context.id,
          domain: "support",
        },
        order: { createdAt: "asc" },
      },
    })

    const answer = await reaction.given(history).agent({
      instruction: "Answer the latest message using the selected history.",
      output: z.object({
        answer: z.string(),
        turn: z.number().int(),
      }),
      actions: [
        support.actions.recordAnswer.scope({
          accountId: reaction.context.content.accountId,
        }),
      ],
    })

    return await reaction.given(answer).emit(
      support.events.responseCreated(answer.payload),
    )
  },
)
```

`reaction.trigger` is the persisted typed trigger. `given(...)` accepts one
Event or one ordered Event array. Every operation returns a persisted Event, so
its typed result is always at `.payload`.

## Run it

```ts
const context = await Context(runtime).create<SupportContext>({
  key: "support:account-42",
  content: { accountId: "account-42", policyVersion: 7 },
})

const trigger = await Events(runtime).emit(
  support.events.messageReceived({
    message: "Summarize the attached report.",
    turn: 1,
  }).link({ files: [fileId] }),
  {
    channel: "email",
    contextId: context.id,
    metadata: { receivedAt: new Date().toISOString() },
  },
)

const response = await context.react(trigger, answerMessage)
```

## Operations

### Agent

`agent` is the only model primitive. Without `output`, its payload is text. With
a Zod output schema, its payload is typed structured data. It may execute only
the scoped domain actions explicitly supplied to it.

```ts
const classification = await reaction.given(reaction.trigger).agent({
  instruction: "Classify the request.",
  output: z.object({ kind: z.enum(["answer", "extract", "clarify"]) }),
})
```

### Domain action

```ts
const recorded = await reaction.given(classification).action(
  support.actions.recordAnswer.scope({ accountId }),
  { answer: "Recorded deterministically." },
)
```

The operation Event contains separate `action` Parts for started and
completed/failed states.

### Dataset

```ts
const items = await reaction.given(reaction.trigger).dataset({
  instruction: "Extract one normalized row per requested item.",
  schema: z.object({ code: z.string(), quantity: z.number() }),
})

items.payload.datasetId
items.payload.preview
items.payload.count
```

### Workspace, shell, and git

```ts
const files = await reaction.given(reaction.trigger).workspace({
  files: reaction.trigger.links.files ?? [],
  directory: "inbound",
  conflict: "verify",
})

const repository = await reaction.given(files).git({
  operation: "clone",
  target: "project",
  url: "https://github.com/e-kairos/example",
  ref: "main",
})

const tests = await reaction.given(repository).shell({
  command: "pnpm",
  args: ["test"],
  cwd: repository.payload.path,
})
```

These operations require a configured sandbox. The durable sandbox id is
reopened for each operation; no live provider object crosses Workflow steps.

### Emit

```ts
const completed = await reaction.given(tests).emit(
  support.events.reviewCompleted({ approved: true, summary: "Tests pass." }),
)
```

`emit` validates that the Event belongs to the Reaction scope.

## Fan-out and fan-in

Starting multiple operations from the same Event creates parallel branches.
Passing their result Events as one array is explicit fan-in.

```ts
const [items, risks] = await Promise.all([
  reaction.given(reaction.trigger).agent({
    instruction: "Extract item facts.",
    output: itemFactsSchema,
  }),
  reaction.given(reaction.trigger).agent({
    instruction: "Assess commercial risks.",
    output: riskSchema,
  }),
])

const decision = await reaction.given([items, risks]).agent({
  instruction: "Decide using both branches.",
  output: decisionSchema,
})
```

## Child Reactions

A nested Reaction receives its own child Session. By default it shares the
parent Context; pass another Context handle to isolate it.

```ts
const requested = await reaction.given(decision).emit(
  support.events.reviewRequested({ subject: "commercial-risk" }),
)

const reviewed = await reaction.react(
  requested,
  defineReaction(
    support.events.reviewRequested,
    {
      key: "support.review",
      scope: support,
      engine: ai({ model: "openai/gpt-5.4" }),
      sandbox: false,
    },
    async child => {
      const review = await child.given(child.trigger).agent({
        instruction: "Review the requested subject.",
        output: reviewSchema,
      })
      return await child.given(review).emit(
        support.events.reviewCompleted(review.payload),
      )
    },
  ),
)
```

For isolation use `reaction.react(otherContext, requested, definition)`.

## Workflow

```ts
export async function supportWorkflow(payload: ReactionWorkflowPayload) {
  "use workflow"
  return await runReactionWorkflow(payload, [answerMessage])
}

await context.react(trigger, answerMessage, {
  workflow: supportWorkflow,
})
```

Workflow execution reuses the prepared Session and idempotent operation ids.
The public surface exports `defineReaction`, `ai`, Workflow helpers, and Reaction
types. The execution bridge lives under `@ekairos/reactor/internal`.

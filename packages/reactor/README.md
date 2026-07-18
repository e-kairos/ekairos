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

Each `agent` operation is one Reaction and owns at most one InstantDB `$stream`.
Every real model round becomes an ordered `context.model` effect Event and every
executed action becomes an ordered `context.action` effect Event. Provider
chunks, sources, action progress, and errors are projected through the same
Reaction stream with the id of the Event they belong to. The terminal model
Event is the return value. Non-streaming operations do not create an empty
stream.

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

An action invoked by Reactor receives one optional `reactionId`. Actions that
need to emit an Event and start a nested Reaction resolve the owning Context
through `Context(runtime).fromReaction(reactionId)`; Reactor does not inject an
execution facade or callbacks into domain code.

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
const files = await reaction.given(reaction.trigger).loadFiles()

const repository = await reaction.given(files).git({
  operation: "clone",
  key: "project",
  url: "https://github.com/e-kairos/example",
  ref: "main",
})

const review = await reaction.given([repository, files]).agent({
  path: repository.payload.path,
  instruction: "Review the repository against the attached request.",
})

const tests = await reaction.given(repository).shell({
  command: "pnpm",
  args: ["test"],
  path: repository.payload.path,
})

const artifacts = await reaction.given([review, tests]).storeFiles({
  path: repository.payload.path,
  files: "review.md",
})
```

`loadFiles()` discovers every `$files` reference in the selected causal closure,
deduplicates by immutable file id, and materializes each file at its canonical
Context path. Git returns a branded logical `path`; callers pass that value to
agent, shell, commit, push, and `storeFiles` instead of constructing provider
directories. Provider `cwd` values remain an internal adapter concern.

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
export async function supportWorkflow(context, trigger) {
  "use workflow"

  return await context.react(trigger, answerMessage)
}

const run = await start(supportWorkflow, [context, trigger])
```

`context.react(...)` always executes in its caller's boundary. Inside a
`"use workflow"` function its Reaction operations become durable Workflow
steps; outside Workflow the same code runs directly. Reactor never starts or
waits for a Workflow implicitly.

## React

`useContext` subscribes to the durable Context graph and to every linked
Reaction stream. While an `agent` is running, its reduced stream is exposed as
Event-shaped `liveEffects`, one projection per current Event id. When each Event
becomes durable, only its matching provisional projection disappears.

```tsx
import { useContext } from "@ekairos/events/react"

const state = useContext(db, {
  apiUrl: "/api/context",
  initialContextId: contextId,
})

state.events          // durable + optimistic + provisional Events, deduplicated
state.sessions        // Session and Reaction graph
state.reactions       // Reactions in the active Session
state.sendStatus      // idle | submitting | streaming | error

const stream = state.reactions[0]?.stream
state.reactions[0]?.liveEffects // current model/action Event projections
stream?.chunks        // complete ordered Reaction journal
stream?.reader        // status, byteOffset, chunkCount, reconnect attempt
```

Stream readers resume from the last complete NDJSON byte offset. Reloading the
UI does not require replaying already consumed chunks, and an interrupted reader
can reconnect while the provider continues writing.

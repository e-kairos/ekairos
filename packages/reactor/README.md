# @ekairos/reactor

`@ekairos/reactor` defines workflow-safe reactors over Ekairos event contexts.

A reactor is a small orchestration unit:

- it receives an existing event as its trigger;
- it materializes or reuses an `event_context`;
- it appends semantic `event_steps` and `event_parts` to the reaction execution;
- it may call model engines and explicit domain actions;
- it finishes with an optional typed output.

The package root exports the new reactor API only.

```ts
import { defineReactor } from "@ekairos/reactor"
```

Existing context-engine APIs live behind the explicit `@ekairos/reactor/context`
subpath while they are migrated.

## Core Shape

```ts
import { z } from "zod"
import { defineReactor } from "@ekairos/reactor"
import { taskDomain } from "./domain/task.domain"

const taskReviewReactor = defineReactor({
  key: "task.review",
  scope: taskDomain,
  context: z.object({
    taskId: z.string(),
    requester: z.string(),
  }),
  output: z.object({
    taskId: z.string(),
  }),
  run: async ({ scope, context, execution }) => {
    const completeTask = scope.completeTask.scope({
      taskId: context.content.taskId,
    })

    const review = await execution.step("review-task", {
      instructions: "Review the task and produce a typed decision.",
      output: z.object({
        accepted: z.boolean(),
      }),
      actions: {
        completeTask,
      },
    })

    await completeTask({
      outcome: review.output,
    })

    await execution.complete({
      message: "Task reviewed.",
      output: {
        taskId: context.content.taskId,
      },
    })
  },
})
```

## Concepts

### Reactor Context

`context` is the initial reactor context. It is parsed once through the declared
Zod schema and passed into the run function as read-only content.

Reactors may also be defined without initial context:

```ts
const freeReactor = defineReactor({
  key: "free.reactor",
  run: async ({ execution }) => {
    await execution.complete({ message: "Done." })
  },
})
```

### Scope

`scope` is the domain surface the reactor can read from. Inside an
`execution.step`, the model engine receives a read-only version of the scope:
`query` and `db.query` are available, but writes are not.

Writes must be declared explicitly as step actions.

### Actions

Actions are domain-owned. A step can only use the actions passed to that step.

Use `action.scope(...)` to bind stable identifiers before exposing an action to
the model or to a local step.

```ts
const updateThisBid = scope.updateBid.scope({ bidId })

await execution.step("update-bid", {
  instructions: "Update this bid with the approved total.",
  actions: {
    updateBid: updateThisBid,
  },
})
```

### Steps

`execution.step(key, config)` is the main durable unit of work. It persists a
step and its parts under the reaction event.

If `config.output` is provided, the configured engine must return output that
passes that schema.

If no engine is configured, a step without output can still be used to persist
deterministic parts.

### Completion

Every reactor run must call `execution.complete(...)`.

The completion is not a model call. It is the explicit finalization of the
reaction execution and may reference a previous step:

```ts
const result = await execution.step("prepare-result", {
  instructions: "Prepare a typed result.",
  output: resultSchema,
})

await execution.complete({
  message: "Result ready.",
  step: result,
})
```

The reaction event stores:

- `content.final`: final typed output, when present;
- `content.finalStepId`: the step that represents the final result.

## Public Entry Points

- `@ekairos/reactor`: new reactor API.
- `@ekairos/reactor/context`: current context-engine boundary used by existing
  packages while they migrate.
- `@ekairos/reactor/runtime`: runtime-only context workflow wiring. Do not import
  it from browser/client modules.

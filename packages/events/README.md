# @ekairos/events

Context-first execution runtime for Ekairos.

Ekairos does not start from an agent session. It starts from a context. A
context receives events, creates executions, opens steps, and persists parts.
The API is designed so orchestration is explicit in TypeScript while streaming,
durability, actions, and replay stay inside the event engine.

```text
event_context
  event_item input
  event_execution
    event_step inspect-file
      event_part reasoning
      event_part action started
      event_part action completed
    event_step summarize-result
      event_part message
  event_item output
```

## The Shape

```ts
import { createContext, type ContextItem } from "@ekairos/events"
import { tool } from "ai"
import { z } from "zod"

const datasetContext = createContext<{ orgId: string; actorId: string }>(
  "dataset.generate",
)
  .context((stored, env) => ({
    ...(stored.content ?? {}),
    orgId: env.orgId,
    actorId: env.actorId,
  }))
  .narrative(() => "Generate datasets from context files.")
  .actions(() => ({}))
  .build()

export async function reactToDatasetUpload(trigger, runtime) {
  const shell = await datasetContext.react(
    trigger,
    {
      runtime,
      context: { key: `dataset:${trigger.id}` },
      options: { maxModelSteps: 1 },
    },
    async (execution) => {
      await execution.context({
        orgId: "org_123",
        actorId: "user_123",
      })

      await execution.prompt("inspect-file", {
        instructions: "Inspect the current context and decide how to parse it.",
      })

      await execution.prompt("parse-dataset", {
        instructions: "Parse the uploaded file and create dataset rows.",
        actions: {
          recordDatasetRows: tool({
            description: "Persist parsed dataset rows.",
            inputSchema: z.object({
              rows: z.array(z.record(z.string(), z.unknown())),
            }),
            execute: async (input, ctx) => {
              "use step"
              // Call the dataset domain here. This action is domain code;
              // @ekairos/events only provides the execution context.
              return await persistDatasetRows({
                runtime: ctx.runtime,
                executionId: ctx.executionId,
                rows: input.rows,
              })
            },
          }),
        },
      })

      await execution.prompt("summarize-result", {
        instructions: "Summarize the generated dataset.",
      })

      return await execution.end({
        message: "Dataset generation completed.",
      })
    },
  )

  return await shell.run
}
```

The callback is the orchestration lane. Every operation on `execution` writes to
the same `event_execution`.

## Workflow Safety

Use the same API from normal code or inside a Workflow function.

```ts
export async function datasetWorkflow(trigger, runtime) {
  "use workflow"

  const shell = await datasetContext.react(
    trigger,
    { runtime, context: { key: `dataset:${trigger.id}` } },
    async (execution) => {
      await execution.prompt("inspect-file", {
        instructions: "Inspect the uploaded file.",
      })

      return await execution.end()
    },
  )

  return await shell.run
}
```

The engine detects Workflow metadata internally. If a workflow run or step is
active, context, execution, step, part, and stream persistence use workflow-safe
operations. Callers do not pass a durability flag.

## Execution API

### `execution.context(content)`

Updates the durable `event_context.content`.

Use it for business state the AI should see as context, not for transient loop
control.

```ts
await execution.context({
  requisition,
  organization,
  policies,
})
```

### `execution.prompt(name, options)`

Opens one `event_step`, runs the configured reactor, streams parts, executes
actions, persists action outputs, and completes the step.

```ts
const result = await execution.prompt("update-requisition", {
  instructions: "Update the requisition title if the user requested it.",
  actions: {
    updateRequisition,
  },
  maxModelSteps: 1,
})
```

Result shape:

```ts
type ContextExecutionPromptResult = {
  stepId: string
  parts: unknown[]
  actionRequests: unknown[]
  actionResults: unknown[]
  reaction: ContextItem
}
```

### `execution.end(input?)`

Closes the reaction item, execution, and context.

```ts
return await execution.end({
  message: "The requisition was updated.",
})
```

## Compared With Flue

Flue exposes a harness/session interface:

```ts
const harness = await init({ model })
const session = await harness.session()
await session.skill("triage", { args, result })
await session.prompt("Write a summary.")
```

Ekairos exposes the same continuity through event primitives:

```ts
const shell = await context.react(triggerEvent, params, async (execution) => {
  await execution.prompt("inspect")
  await execution.prompt("act", { actions })
  await execution.prompt("summarize")
  return await execution.end()
})

const result = await shell.run
```

| Flue concept | Ekairos concept |
| --- | --- |
| harness | configured context runtime |
| session | event_execution |
| prompt | event_step with streamed event_parts |
| skill | future reusable workflow step |
| shell/filesystem | execution workspace policy |
| structured result | action output or final event_item |

The important difference: Ekairos keeps `context`, `execution`, `step`, and
`part` as the source of truth. The UI can inspect the same persisted structure
that the engine uses to stream and replay.

## Canonical Entities

- `event_contexts`: durable state and lifecycle.
- `event_items`: input and output events visible to the context.
- `event_executions`: one orchestration lane for a reaction.
- `event_steps`: named operations inside an execution.
- `event_parts`: canonical streamed content, reasoning, sources, and actions.
- `event_trace_*`: technical trace and runtime telemetry.

`event_parts` are the source of truth for step inspection and replay. Mirrored
`event_item.content.parts` are only the visible aggregate.

## Dataset Flow Example

```ts
const shell = await datasetContext.react(triggerEvent, params, async (execution) => {
  await execution.prompt("inspect-file", {
    instructions: "Inspect the current context files.",
  })

  await execution.prompt("generate-dataset", {
    instructions: [
      "Use the prepared execution workspace.",
      "Write output rows to output/output.jsonl.",
      "Return the storage file id and row count.",
    ].join("\n"),
    actions: { executeCommand },
  })

  await execution.prompt("validate-dataset", {
    instructions: "Validate the generated dataset and explain any rejected rows.",
  })

  return await execution.end({
    message: "Dataset is ready.",
  })
})

const result = await shell.run
```

Expected persisted shape:

```text
event_execution
  event_step inspect-file
    message/reasoning parts
  event_step generate-dataset
    action executeCommand started
    action executeCommand completed
  event_step validate-dataset
    message parts
```

## Current Status

Implemented:

- explicit `const shell = await context.react(triggerEvent, params, async execution => ...)`
- `execution.context(...)`
- `execution.prompt(...)`
- `execution.end(...)`
- automatic workflow-safe runtime selection
- canonical `event_parts` persistence for explicit prompts

Next primitives to design:

- `execution.skill(...)` as a reusable workflow step
- execution workspace policy for context files and execution outputs
- structured prompt/result schemas

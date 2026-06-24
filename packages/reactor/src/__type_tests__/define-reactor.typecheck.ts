import { i } from "@instantdb/core"
import { z } from "zod"

import {
  defineAction,
  domain,
  EkairosRuntime,
} from "@ekairos/domain"
import type { ContextItem } from "@ekairos/events"

import { defineReactor } from "../reactor.js"

type Env = {
  orgId: string
}

const tasksDomain = domain("reactor-typecheck-tasks")
  .schema({
    entities: {
      task_tasks: i.entity({
        title: i.string(),
        state: i.string(),
      }),
    },
    links: {},
    rooms: {},
  })
  .withActions({
    completeTask: defineAction({
      input: z.object({
        taskId: z.string(),
        outcome: z.object({
          accepted: z.boolean(),
        }),
      }),
      output: z.object({
        taskId: z.string(),
        state: z.literal("completed"),
      }),
      execute: async ({ input }) => ({
        taskId: input.taskId,
        state: "completed" as const,
      }),
    }),
  })

class TasksRuntime extends EkairosRuntime<Env, typeof tasksDomain, any> {
  protected getDomain() {
    return tasksDomain
  }

  protected async resolveDb() {
    return {}
  }
}

const triggerEvent: ContextItem = {
  id: "event_1",
  type: "input",
  channel: "web",
  createdAt: new Date().toISOString(),
  content: {},
}

const taskReviewContextSchema = z.object({
  taskId: z.string(),
  requester: z.string(),
})

const taskReviewOutcomeSchema = z.object({
  taskId: z.string(),
})

const taskReviewReactor = defineReactor({
  key: "task.review",
  scope: tasksDomain,
  context: taskReviewContextSchema,
  output: taskReviewOutcomeSchema,
  engine: {
    step: async () => ({
      accepted: true,
    }),
  },
  run: async ({ scope, context, execution }) => {
    const completeThisTask = scope.completeTask.scope({
      taskId: context.content.taskId,
    })

    const review = await execution.step("review-task", {
      instructions: "Review the task and produce a typed decision.",
      output: z.object({ accepted: z.boolean() }),
      actions: {
        completeTask: completeThisTask,
      },
    })

    await completeThisTask({
      outcome: review.output,
    })

    // @ts-expect-error taskId was already bound by .scope().
    await completeThisTask({
      taskId: context.content.taskId,
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

const emptyContextReactor = defineReactor({
  key: "free.reactor",
  run: async ({ context, scope, execution }) => {
    const noScope: undefined = scope

    // @ts-expect-error no initial context means content is the closed empty object.
    context.content.anything

    await execution.complete({
      message: "Done without initial context.",
    })
  },
})

async function check() {
  const runtime = new TasksRuntime({ orgId: "org_1" })
  const taskReview = taskReviewReactor(runtime)
  await taskReview.react({ key: "task:review" }, triggerEvent, {
    env: { orgId: "org_1" },
    context: {
      taskId: "task_1",
      requester: "accounting",
    },
  })

  // @ts-expect-error env stays typed.
  await taskReview.react({ key: "task:review" }, triggerEvent, {
    env: {},
    context: {
      taskId: "task_1",
      requester: "accounting",
    },
  })

  // @ts-expect-error context is required when the reactor declares a context schema.
  await taskReview.react({ key: "task:review" }, triggerEvent, {
    env: { orgId: "org_1" },
  })

  // @ts-expect-error context shape stays typed.
  await taskReview.react({ key: "task:review" }, triggerEvent, {
    env: { orgId: "org_1" },
    context: {
      wrong: "task_1",
    },
  })

  const free = emptyContextReactor(runtime)
  await free.react(null, triggerEvent, { env: {} })
}

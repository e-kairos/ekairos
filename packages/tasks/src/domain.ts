import { i } from "@instantdb/core"
import { defineAction, domain } from "@ekairos/domain"
import { z } from "zod"

import {
  awaitOutcomeExecute,
  cancelTaskExecute,
  decideTaskExecute,
  failTaskExecute,
  getTaskExecute,
  openTaskExecute,
} from "./actions.js"

const storedOutcomeSchema = z.object({
  type: z.literal("json-schema"),
  schema: z.unknown(),
})

const taskRecordSchema = z.object({
  id: z.string(),
  kind: z.string(),
  key: z.string(),
  status: z.enum(["open", "completed", "cancelled", "failed"]),
  instructions: z.string(),
  context: z.unknown(),
  outcomeKind: z.string().optional(),
  outcomeSchema: storedOutcomeSchema.optional(),
  resolvedOutcome: z.unknown().optional(),
  errorText: z.string().optional(),
  createdAt: z.unknown().optional(),
  updatedAt: z.unknown().optional(),
  resolvedAt: z.unknown().optional(),
})

const taskServiceResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: taskRecordSchema,
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    issues: z.unknown().optional(),
  }),
])

const taskOutcomeResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.unknown(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    issues: z.unknown().optional(),
  }),
])

const openTaskInputSchema = z.object({
  id: z.string().optional(),
  kind: z.string(),
  key: z.string(),
  instructions: z.string(),
  context: z.unknown().optional(),
  outcomeKind: z.string().optional(),
  outcomeSchema: storedOutcomeSchema,
})

const decideTaskInputSchema = z.object({
  id: z.string(),
  outcome: z.unknown(),
  resumeWorkflow: z.boolean().optional(),
})

const cancelTaskInputSchema = z.object({
  id: z.string(),
  reason: z.string().optional(),
})

const failTaskInputSchema = z.object({
  id: z.string(),
  errorText: z.string(),
})

const getTaskInputSchema = z.object({
  id: z.string(),
})

const awaitOutcomeInputSchema = z.object({
  id: z.string(),
})

export const tasksDomain = domain("tasks")
  .withSchema({
    entities: {
      task_tasks: i.entity({
        kind: i.string().indexed(),
        key: i.string().unique().indexed(),
        status: i.string().indexed(),
        instructions: i.string().optional(),
        context: i.json().optional(),
        outcomeKind: i.string().optional().indexed(),
        outcomeSchema: i.json().optional(),
        outcome: i.json().optional(),
        errorText: i.string().optional(),
        createdAt: i.date().indexed(),
        updatedAt: i.date().indexed(),
        resolvedAt: i.date().optional().indexed(),
      }),
    },
    links: {},
    rooms: {},
  })
  .withActions({
    openTask: defineAction({
      name: "tasks.openTask",
      input: openTaskInputSchema,
      output: taskServiceResultSchema,
      execute: openTaskExecute,
    }),
    getTask: defineAction({
      name: "tasks.getTask",
      input: getTaskInputSchema,
      output: taskServiceResultSchema,
      execute: getTaskExecute,
    }),
    awaitOutcome: defineAction({
      name: "tasks.awaitOutcome",
      input: awaitOutcomeInputSchema,
      output: taskOutcomeResultSchema,
      execute: awaitOutcomeExecute,
    }),
    decideTask: defineAction({
      name: "tasks.decideTask",
      input: decideTaskInputSchema,
      output: taskServiceResultSchema,
      execute: decideTaskExecute,
    }),
    cancelTask: defineAction({
      name: "tasks.cancelTask",
      input: cancelTaskInputSchema,
      output: taskServiceResultSchema,
      execute: cancelTaskExecute,
    }),
    failTask: defineAction({
      name: "tasks.failTask",
      input: failTaskInputSchema,
      output: taskServiceResultSchema,
      execute: failTaskExecute,
    }),
  })

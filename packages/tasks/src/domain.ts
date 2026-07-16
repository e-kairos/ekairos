import { i } from "@instantdb/core"
import {
  DOMAIN_ACTION_FULL_INPUT_TYPE,
  DOMAIN_ACTION_OWNER_TYPE,
  DOMAIN_ACTION_RUNTIME_TYPE,
  defineAction,
  domain,
} from "@ekairos/domain"
import { z } from "zod"

import {
  awaitOutcomeExecute,
  cancelTaskExecute,
  decideTaskExecute,
  failTaskExecute,
  getTaskExecute,
  openTaskExecute,
  startTaskExecute,
} from "./actions.js"

const storedOutcomeSchema = z.object({
  type: z.literal("json-schema"),
  schema: z.unknown(),
})

const taskRecordSchema = z.object({
  id: z.string(),
  kind: z.string(),
  key: z.string(),
  state: z.enum(["open", "in_progress", "completed", "cancelled", "failed"]),
  parentId: z.string().optional(),
  dependsOnTaskIds: z.array(z.string()).optional(),
  instructions: z.string(),
  context: z.unknown(),
  outcomeKind: z.string().optional(),
  outcomeSchema: storedOutcomeSchema.optional(),
  resolvedOutcome: z.unknown().optional(),
  activeRunId: z.string().optional(),
  activeDeploymentId: z.string().optional(),
  lastProgress: z.unknown().optional(),
  errorText: z.string().optional(),
  createdAt: z.unknown().optional(),
  updatedAt: z.unknown().optional(),
  startedAt: z.unknown().optional(),
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
  parentTaskId: z.string().optional(),
  dependsOnTaskIds: z.array(z.string()).optional(),
  instructions: z.string(),
  context: z.unknown().optional(),
  outcomeKind: z.string().optional(),
  outcomeSchema: storedOutcomeSchema,
})

const decideTaskInputSchema = z.object({
  id: z.string(),
  outcome: z.unknown(),
  resumeWorkflow: z.boolean().optional(),
  runId: z.string().optional(),
})

const cancelTaskInputSchema = z.object({
  id: z.string(),
  reason: z.string().optional(),
  runId: z.string().optional(),
})

const failTaskInputSchema = z.object({
  id: z.string(),
  errorText: z.string(),
  runId: z.string().optional(),
})

const startTaskInputSchema = z.object({
  id: z.string(),
  runId: z.string(),
  deploymentId: z.string().optional(),
  actor: z.unknown().optional(),
  comment: z.string().optional(),
})

const getTaskInputSchema = z.object({
  id: z.string(),
})

const awaitOutcomeInputSchema = z.object({
  id: z.string(),
})

export const tasksSchemaDomain = domain("tasks")
  .withSchema({
    entities: {
      task_tasks: i.entity({
        kind: i.string().indexed(),
        key: i.string().unique().indexed(),
        state: i.string().indexed(),
        instructions: i.string().optional(),
        context: i.json().optional(),
        outcomeKind: i.string().optional().indexed(),
        outcomeSchema: i.json().optional(),
        outcome: i.json().optional(),
        activeRunId: i.string().optional().indexed(),
        activeDeploymentId: i.string().optional().indexed(),
        lastProgress: i.json().optional(),
        errorText: i.string().optional(),
        createdAt: i.date().indexed(),
        updatedAt: i.date().indexed(),
        startedAt: i.date().optional().indexed(),
        resolvedAt: i.date().optional().indexed(),
      }),
    },
    links: {
      taskTasksChildren: {
        forward: { on: "task_tasks", has: "many", label: "children" },
        reverse: { on: "task_tasks", has: "one", label: "parent" },
      },
      taskTasksDependencies: {
        forward: { on: "task_tasks", has: "many", label: "dependsOn" },
        reverse: { on: "task_tasks", has: "many", label: "dependents" },
      },
    },
    rooms: {},
  })

const taskActions = {
  createTask: defineAction({
    input: openTaskInputSchema,
    output: taskServiceResultSchema,
    execute: openTaskExecute,
  }),
  getTask: defineAction({
    input: getTaskInputSchema,
    output: taskServiceResultSchema,
    execute: getTaskExecute,
  }),
  awaitOutcome: defineAction({
    input: awaitOutcomeInputSchema,
    output: taskOutcomeResultSchema,
    execute: awaitOutcomeExecute,
  }),
  startTask: defineAction({
    input: startTaskInputSchema,
    output: taskServiceResultSchema,
    execute: startTaskExecute,
  }),
  completeTask: defineAction({
    input: decideTaskInputSchema,
    output: taskServiceResultSchema,
    execute: decideTaskExecute,
  }),
  cancelTask: defineAction({
    input: cancelTaskInputSchema,
    output: taskServiceResultSchema,
    execute: cancelTaskExecute,
  }),
  failTask: defineAction({
    input: failTaskInputSchema,
    output: taskServiceResultSchema,
    execute: failTaskExecute,
  }),
} as const

export const tasksDomain = tasksSchemaDomain.withActions(taskActions)

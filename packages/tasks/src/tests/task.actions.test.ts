import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  tasksDomain,
  toStoredOutcomeSchema,
} from "../index.ts"
import { createMemoryTaskRuntime, type MemoryTaskRuntime } from "./memory-task-db.ts"

const reviewOutcomeSchema = z.object({
  accepted: z.boolean(),
})

type TaskActionKey = keyof typeof tasksDomain.actions

async function executeAction(
  runtime: MemoryTaskRuntime,
  action: TaskActionKey,
  input: unknown,
) {
  const tasks = await runtime.use(tasksDomain)
  const actions = tasks.actions as Record<TaskActionKey, (input: any) => Promise<any>>
  return await actions[action](input)
}

describe("tasks domain actions", () => {
  it("exposes the canonical task action API", () => {
    expect(Object.values(tasksDomain.actions).map((action) => action.name)).toEqual([
      "tasks.openTask",
      "tasks.getTask",
      "tasks.awaitOutcome",
      "tasks.decideTask",
      "tasks.cancelTask",
      "tasks.failTask",
    ])
  })

  it("opens and decides a task through domain actions without a waiting workflow", async () => {
    const runtime = createMemoryTaskRuntime()

    const opened = await executeAction(runtime, "openTask", {
      id: "task_action_1",
      kind: "review",
      key: "review:action:1",
      instructions: "Review action outcome.",
      context: { entityId: "entity_1" },
      outcomeKind: "review",
      outcomeSchema: toStoredOutcomeSchema(reviewOutcomeSchema),
    })

    expect(opened).toMatchObject({
      ok: true,
      data: {
        id: "task_action_1",
        status: "open",
      },
    })

    const fetched = await executeAction(runtime, "getTask", {
      id: "task_action_1",
    })

    expect(fetched).toMatchObject({
      ok: true,
      data: {
        id: "task_action_1",
        status: "open",
      },
    })

    const decided = await executeAction(runtime, "decideTask", {
      id: "task_action_1",
      outcome: { accepted: true },
    })

    expect(decided).toMatchObject({
      ok: true,
      data: {
        id: "task_action_1",
        status: "completed",
        resolvedOutcome: { accepted: true },
      },
    })

    const outcome = await executeAction(runtime, "awaitOutcome", {
      id: "task_action_1",
    })

    expect(outcome).toMatchObject({
      ok: true,
      data: { accepted: true },
    })
  })

  it("validates action decisions against the stored outcome schema", async () => {
    const runtime = createMemoryTaskRuntime()

    const opened = await executeAction(runtime, "openTask", {
      id: "task_action_2",
      kind: "review",
      key: "review:action:2",
      instructions: "Review action outcome.",
      context: {},
      outcomeSchema: toStoredOutcomeSchema(reviewOutcomeSchema),
    })
    expect(opened.ok).toBe(true)

    const invalid = await executeAction(runtime, "decideTask", {
      id: "task_action_2",
      outcome: { accepted: "yes" },
      resumeWorkflow: false,
    })

    expect(invalid).toMatchObject({
      ok: false,
      error: "task_outcome_invalid",
    })
    expect(runtime.memoryDb.tasks.get("task_action_2")).toMatchObject({
      status: "open",
    })
  })
})

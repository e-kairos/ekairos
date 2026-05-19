import { describe, expect, it } from "vitest"
import { z } from "zod"

import { approvalOutcomeSchema, Task, tasksDomain } from "../index.ts"
import { createMemoryTaskRuntime, type MemoryTaskRuntime } from "./memory-task-db.ts"

const reviewOutcomeSchema = z.object({
  accepted: z.boolean(),
  comment: z.string().optional(),
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

describe("Task", () => {
  it("opens a task", async () => {
    const runtime = createMemoryTaskRuntime()

    const task = await Task.open(runtime, {
      id: "task_review_1",
      kind: "review",
      key: "review:execution_1:step_1",
      outcome: reviewOutcomeSchema,
      instructions: "Review the generated step.",
      context: { entityId: "entity_1" },
      outcomeKind: "review",
    })

    expect(task).toMatchObject({
      id: "task_review_1",
      kind: "review",
      key: "review:execution_1:step_1",
      status: "open",
      context: { entityId: "entity_1" },
    })
    expect(runtime.memoryDb.tasks.get("task_review_1")).toMatchObject({
      kind: "review",
      key: "review:execution_1:step_1",
      status: "open",
      outcomeKind: "review",
    })
  })

  it("is idempotent by key and returns the existing task", async () => {
    const runtime = createMemoryTaskRuntime()

    const first = await Task.open(runtime, {
      id: "task_first",
      kind: "review",
      key: "review:same-key",
      outcome: reviewOutcomeSchema,
      instructions: "Review once.",
      context: { n: 1 },
    })
    const second = await Task.open(runtime, {
      id: "task_second",
      kind: "review",
      key: "review:same-key",
      outcome: reviewOutcomeSchema,
      instructions: "Review again.",
      context: { n: 2 },
    })

    expect(first.id).toBe("task_first")
    expect(second.id).toBe("task_first")
    expect(runtime.memoryDb.tasks.size).toBe(1)

    await expect(
      Task.open(runtime, {
        id: "task_third",
        kind: "review",
        key: "review:same-key",
        outcome: z.object({ accepted: z.string() }),
        instructions: "Review with the wrong schema.",
        context: { n: 3 },
      }),
    ).rejects.toThrow("task_outcome_schema_mismatch")
  })

  it("gets a persisted task and resolves its completed typed outcome", async () => {
    const runtime = createMemoryTaskRuntime()

    const task = await Task.approval(runtime, {
      id: "task_approval_1",
      key: "approval:1",
      instructions: "Approve this.",
      context: { entityId: "entity_1" },
    })

    await executeAction(runtime, "decideTask", {
      id: task.id,
      outcome: {
        outcome: "approved",
        approved: true,
      },
      resumeWorkflow: false,
    })

    const persisted = await Task.get(runtime, "task_approval_1", approvalOutcomeSchema)

    await expect(persisted.outcome()).resolves.toEqual({
      outcome: "approved",
      approved: true,
    })
    expect(runtime.memoryDb.tasks.get("task_approval_1")).toMatchObject({
      status: "completed",
      outcome: {
        outcome: "approved",
        approved: true,
      },
    })
  })

  it("rejects invalid outcomes before mutating the task", async () => {
    const runtime = createMemoryTaskRuntime()

    await Task.approval(runtime, {
      id: "task_approval_1",
      key: "approval:1",
      instructions: "Approve this.",
      context: { entityId: "entity_1" },
    })

    await expect(
      executeAction(runtime, "decideTask", {
        id: "task_approval_1",
        outcome: {
          outcome: "rejected",
          approved: false,
          reason: "",
        },
        resumeWorkflow: false,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: "task_outcome_invalid",
    })

    const stored = runtime.memoryDb.tasks.get("task_approval_1")
    expect(stored).toMatchObject({
      status: "open",
    })
    expect(stored).not.toHaveProperty("outcome")
  })

  it("rejects getting a task with a schema that does not match storage", async () => {
    const runtime = createMemoryTaskRuntime()
    await Task.open(runtime, {
      id: "task_review_1",
      kind: "review",
      key: "review:schema",
      outcome: reviewOutcomeSchema,
      instructions: "Review this.",
      context: {},
    })

    await expect(
      Task.get(
        runtime,
        "task_review_1",
        z.object({ accepted: z.string() }),
      ),
    ).rejects.toThrow("Task outcome schema does not match")
  })

  it("resolves an already-decided outcome from storage even when no workflow hook waited", async () => {
    const runtime = createMemoryTaskRuntime()
    const task = await Task.open(runtime, {
      id: "task_decided_before_outcome",
      kind: "review",
      key: "review:decided-before-outcome",
      outcome: reviewOutcomeSchema,
      instructions: "Review this.",
      context: {},
    })

    await executeAction(runtime, "decideTask", {
      id: task.id,
      outcome: {
        accepted: true,
        comment: "stored before outcome()",
      },
    })

    await expect(task.outcome()).resolves.toEqual({
      accepted: true,
      comment: "stored before outcome()",
    })
  })
})

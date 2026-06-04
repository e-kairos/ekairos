/* @vitest-environment node */

import { waitForHook } from "@workflow/vitest"
import { id as instantId } from "@instantdb/core"
import { describe, expect, it } from "vitest"
import { start } from "workflow/api"

import { tasksDomain, taskOutcomeToken, toStoredOutcomeSchema } from "../index.ts"
import { createMemoryTaskRuntime } from "./memory-task-db.ts"
import {
  approvalTaskOutcomeWorkflow,
  scoreOutcomeSchema,
  typedTaskOutcomeWorkflow,
} from "./workflow/task.workflow-fixtures.ts"
import { approvalOutcomeSchema } from "../approval.ts"
import type { MemoryTaskRuntime } from "./memory-task-db.ts"
import type { ServiceResult, TaskRecord } from "../service.ts"

type TaskActionKey = keyof typeof tasksDomain.actions

async function executeAction(
  runtime: MemoryTaskRuntime,
  action: TaskActionKey,
  input: unknown,
): Promise<ServiceResult<TaskRecord>> {
  const scoped = await tasksDomain(runtime)
  const actions = scoped.actions as Record<
    TaskActionKey,
    (input: unknown) => Promise<ServiceResult<TaskRecord>>
  >
  return await actions[action](input)
}

describe("task workflow integration", () => {
  it("waits for a typed task outcome through a workflow hook", async () => {
    const id = instantId()
    const runtime = createMemoryTaskRuntime()
    const opened = await executeAction(runtime, "createTask", {
      id,
      kind: "score.review",
      key: id,
      instructions: "Score this execution.",
      context: { executionId: "exec_workflow_1" },
      outcomeSchema: toStoredOutcomeSchema(scoreOutcomeSchema),
    })
    expect(opened.ok).toBe(true)

    const run = await start(typedTaskOutcomeWorkflow, [runtime, { id }])

    const hook = await waitForHook(run, {
      token: taskOutcomeToken(id),
      timeout: 20_000,
    })

    expect(hook.token).toBe(taskOutcomeToken(id))

    const decided = await executeAction(runtime, "completeTask", {
      id,
      outcome: {
        score: 10,
        label: "ready",
      },
    })
    expect(decided).toMatchObject({ ok: true })

    await expect(run.returnValue).resolves.toEqual({
      id,
      kind: "score.review",
      outcome: {
        score: 10,
        label: "ready",
      },
    })
  })

  it("keeps approval as a typed preset over generic task outcomes", async () => {
    const id = instantId()
    const runtime = createMemoryTaskRuntime()
    const opened = await executeAction(runtime, "createTask", {
      id,
      kind: "approval",
      key: id,
      instructions: "Approve this workflow operation.",
      context: { executionId: "exec_workflow_approval" },
      outcomeKind: "approval",
      outcomeSchema: toStoredOutcomeSchema(approvalOutcomeSchema),
    })
    expect(opened.ok).toBe(true)

    const run = await start(approvalTaskOutcomeWorkflow, [runtime, { id }])

    const hook = await waitForHook(run, {
      token: taskOutcomeToken(id),
      timeout: 20_000,
    })

    expect(hook.token).toBe(taskOutcomeToken(id))

    const decided = await executeAction(runtime, "completeTask", {
      id,
      outcome: {
        outcome: "rejected",
        approved: false,
        reason: "Needs another review pass.",
        decidedBy: "user_1",
        decidedAt: "2026-05-18T00:00:00.000Z",
      },
    })
    expect(decided).toMatchObject({ ok: true })

    await expect(run.returnValue).resolves.toEqual({
      outcome: "rejected",
      approved: false,
      reason: "Needs another review pass.",
      decidedBy: "user_1",
      decidedAt: "2026-05-18T00:00:00.000Z",
    })
  })

  it("resolves from the stored outcome if the task was decided before the workflow waited", async () => {
    const id = instantId()
    const runtime = createMemoryTaskRuntime()

    const opened = await executeAction(runtime, "createTask", {
      id,
      kind: "score.review",
      key: id,
      instructions: "Score this execution.",
      context: { executionId: "exec_decided_first" },
      outcomeSchema: toStoredOutcomeSchema(scoreOutcomeSchema),
    })
    expect(opened.ok).toBe(true)

    const decided = await executeAction(runtime, "completeTask", {
      id,
      outcome: {
        score: 7,
        label: "already-decided",
      },
    })
    expect(decided).toMatchObject({ ok: true })

    const run = await start(typedTaskOutcomeWorkflow, [runtime, { id }])

    await expect(run.returnValue).resolves.toEqual({
      id,
      kind: "score.review",
      outcome: {
        score: 7,
        label: "already-decided",
      },
    })
  })

  it("rejects the waiting workflow when a task fails", async () => {
    const id = instantId()
    const runtime = createMemoryTaskRuntime()
    const opened = await executeAction(runtime, "createTask", {
      id,
      kind: "score.review",
      key: id,
      instructions: "Score this execution.",
      context: { executionId: "exec_failed" },
      outcomeSchema: toStoredOutcomeSchema(scoreOutcomeSchema),
    })
    expect(opened.ok).toBe(true)

    const run = await start(typedTaskOutcomeWorkflow, [runtime, { id }])

    const hook = await waitForHook(run, {
      token: taskOutcomeToken(id),
      timeout: 20_000,
    })

    expect(hook.token).toBe(taskOutcomeToken(id))

    const failed = await executeAction(runtime, "failTask", {
      id,
      errorText: "runner failed",
    })
    expect(failed).toMatchObject({ ok: true })

    await expect(run.returnValue).rejects.toThrow("runner failed")
  })
})

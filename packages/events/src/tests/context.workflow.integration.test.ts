/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"
import { start } from "workflow/api"

import { eventsDomain } from "../index.ts"
import {
  asRecord,
  contextReactParentWorkflow,
  expandedContextReactWorkflow,
  nestedContextReactWorkflow,
  readRows,
  readString,
  runSmokeContext,
  storySmoke,
} from "./workflow/context.workflow-fixtures.ts"
import {
  destroyContextTestApp,
  hasInstantProvisionToken,
  provisionContextTestApp,
} from "./_env.js"
import { EventsTestRuntime } from "./workflow/context.test-runtime.ts"

let appId: string | null = null
let adminToken: string | null = null
let db: ReturnType<typeof init> | null = null

function currentDb() {
  if (!db) {
    throw new Error("Workflow integration DB is not initialized.")
  }
  return db
}

function findPersistedActionPart(
  partRows: Record<string, unknown>[],
  actionName: string,
  expectedToolState: "output-available" | "output-error",
): Record<string, unknown> | null {
  const expectedStatus = expectedToolState === "output-available" ? "completed" : "failed"

  for (const row of partRows) {
    const part = asRecord(row.part)
    if (!part) continue

    const content = asRecord(part.content)
    if (
      part.type === "action" &&
      content?.status === expectedStatus &&
      content?.actionName === actionName
    ) {
      return part
    }

    if (
      readString(part, "type") === "tool-result" &&
      readString(part, "toolName") === actionName &&
      readString(part, "state") === expectedToolState
    ) {
      return part
    }
  }

  return null
}

function readPersistedActionOutput(
  part: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!part) return null
  if (part.type === "action") {
    return asRecord(asRecord(part.content)?.output)
  }

  return asRecord(part.output)
}

const describeWorkflowInstant = hasInstantProvisionToken() ? describe : describe.skip

describeWorkflowInstant("context workflow integration", () => {
  beforeAll(async () => {
    const schema = eventsDomain.toInstantSchema()
    const app = await provisionContextTestApp({
      name: `context-workflow-vitest-${Date.now()}`,
      schema,
    })

    appId = app.appId
    adminToken = app.adminToken
    db = init({
      appId: app.appId,
      adminToken: app.adminToken,
      schema,
    } as any)
  }, 10 * 60 * 1000)

  afterAll(async () => {
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyContextTestApp(appId)
    }
  }, 10 * 60 * 1000)

  async function verifyPersistedExecution(params: {
    executionId: string
    contextId: string
    expectedWorkflowRunId: string | null
    expectedToolState?: "output-available" | "output-error"
    expectedMode?: "success" | "tool-error" | "scripted"
  }) {
    const snapshot = await currentDb().query({
      event_executions: {
        $: { where: { id: params.executionId }, limit: 1 },
      },
      event_steps: {
        $: { where: { "execution.id": params.executionId }, limit: 50 },
      },
      event_items: {
        $: { where: { "context.id": params.contextId }, limit: 50 },
      },
    })

    const executionRow = readRows(snapshot, "event_executions")[0]
    const stepRows = readRows(snapshot, "event_steps")
    const itemRows = readRows(snapshot, "event_items")

    expect(readString(executionRow, "status")).toBe("completed")
    expect(readString(executionRow, "workflowRunId")).toBe(params.expectedWorkflowRunId)
    expect(stepRows.length).toBeGreaterThan(0)

    if (params.expectedToolState) {
      const firstStepId = readString(stepRows[0], "id")
      expect(firstStepId).toBeTruthy()

      const partsSnapshot = await currentDb().query({
        event_parts: {
          $: {
            where: { stepId: firstStepId as any },
            limit: 50,
            order: { idx: "asc" },
          },
        },
      })

      const partRows = readRows(partsSnapshot, "event_parts")
      const toolResultPart = findPersistedActionPart(
        partRows,
        "echo",
        params.expectedToolState,
      )
      expect(toolResultPart).toBeTruthy()

      if (params.expectedToolState === "output-available" && params.expectedMode) {
        const toolOutput = readPersistedActionOutput(toolResultPart)
        const jsonValue = asRecord(toolOutput?.value)
        expect(readString(jsonValue ?? undefined, "mode")).toBe(params.expectedMode)
        expect(readString(jsonValue ?? undefined, "contextId")).toBe(params.contextId)
        expect(readString(jsonValue ?? undefined, "stepId")).toBe(String(firstStepId))
        expect((jsonValue as any)?.hasDb).toBe(true)
      }
    }

    const reactionItem = itemRows.find((row) => readString(row, "type") === "output")
    expect(readString(reactionItem, "status")).toBe("completed")
    return executionRow
  }

  it("react associates executions with the current workflow run when called inside workflow", async () => {
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      mode: "scripted",
    })

    const workflowRun = await start(contextReactParentWorkflow, [
      {
        runtime,
        triggerText: "workflow parent trigger",
      },
    ])
    const final = await workflowRun.returnValue

    expect(final.parentWorkflowRunId).toBe(workflowRun.runId)
    expect(final.finalExecutionStatus).toBe("completed")
    expect(final.finalReactionStatus).toBe("completed")

    await verifyPersistedExecution({
      executionId: final.executionId,
      contextId: final.contextId,
      expectedWorkflowRunId: workflowRun.runId,
      expectedToolState: "output-available",
      expectedMode: "scripted",
    })
  }, 10 * 60 * 1000)

  it("nested context react persists explicit parent execution references", async () => {
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      mode: "scripted",
    })

    const workflowRun = await start(nestedContextReactWorkflow, [
      {
        runtime,
        triggerText: "nested workflow parent trigger",
      },
    ])
    const final = await workflowRun.returnValue

    expect(final.parentWorkflowRunId).toBe(workflowRun.runId)
    expect(final.finalExecutionStatus).toBe("completed")
    expect(final.childFinalExecutionStatus).toBe("completed")
    expect(final.childFinalReactionStatus).toBe("completed")

    await verifyPersistedExecution({
      executionId: final.executionId,
      contextId: final.contextId,
      expectedWorkflowRunId: workflowRun.runId,
      expectedToolState: "output-available",
      expectedMode: "scripted",
    })
    const childExecution = await verifyPersistedExecution({
      executionId: final.childExecutionId,
      contextId: final.childContextId,
      expectedWorkflowRunId: workflowRun.runId,
      expectedToolState: "output-available",
      expectedMode: "scripted",
    })

    expect(readString(childExecution, "parentExecutionId")).toBe(final.executionId)
    expect(readString(childExecution, "parentContextId")).toBe(final.contextId)
  }, 10 * 60 * 1000)

  it("expanded standard events reach reactors inside workflow", async () => {
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      mode: "scripted",
    })

    const workflowRun = await start(expandedContextReactWorkflow, [
      {
        runtime,
        triggerText: "expanded workflow trigger",
      },
    ])
    const final = await workflowRun.returnValue

    expect(final.parentWorkflowRunId).toBe(workflowRun.runId)
    expect(final.finalExecutionStatus).toBe("completed")

    await verifyPersistedExecution({
      executionId: final.executionId,
      contextId: final.contextId,
      expectedWorkflowRunId: workflowRun.runId,
    })
  }, 10 * 60 * 1000)

  it("react outside workflow has no workflow run id", async () => {
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      mode: "scripted",
    })

    const final = await runSmokeContext({
      context: storySmoke,
      runtime,
      triggerText: "runtime direct trigger",
    })

    await verifyPersistedExecution({
      executionId: final.execution.id,
      contextId: final.context.id,
      expectedWorkflowRunId: null,
      expectedToolState: "output-available",
      expectedMode: "scripted",
    })
  }, 10 * 60 * 1000)
})

/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { start } from "workflow/api"
import { createTestApp, destroyTestApp } from "@ekairos/testing/provision"

import {
  executeRuntimeActionWorkflow,
  runtimeWorkflowDomain,
  RuntimeWorkflowTestRuntime,
  scopedDomainActionsWorkflow,
} from "./runtime.workflow-fixtures.js"

function hasInstantProvisionToken() {
  return Boolean(String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim())
}

const describeRuntimeWorkflow = hasInstantProvisionToken() ? describe : describe.skip

describeRuntimeWorkflow("step-safe domain actions", () => {
  let appId = ""
  let adminToken = ""

  beforeAll(async () => {
    const app = await createTestApp({
      name: `domain-runtime-workflow-${Date.now()}`,
      token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim(),
      schema: runtimeWorkflowDomain.toInstantSchema(),
    })

    appId = app.appId
    adminToken = app.adminToken
  }, 5 * 60 * 1000)

  afterAll(async () => {
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyTestApp({
        appId,
        token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim(),
      })
    }
  }, 5 * 60 * 1000)

  it(
    "runs executeRuntimeAction through step-safe domain actions inside a workflow",
    async () => {
      const runtime = new RuntimeWorkflowTestRuntime({
        appId,
        adminToken,
        marker: `runtime-marker-execute-${Date.now()}`,
      })
      const probeId = `probe-execute-${Date.now()}`
      const label = "  runtime action workflow  "

      const run = await start(executeRuntimeActionWorkflow, [
        runtime,
        { probeId, label },
      ])

      const result = await run.returnValue

      expect(result.rootRuntimeKey).toBe(runtime.key())
      expect(result.rootMarker).toBe(runtime.env.marker)

      expect(result.created.isRuntimeInstance).toBe(true)
      expect(result.created.runtimeKey).toBe(runtime.key())
      expect(result.created.marker).toBe(runtime.env.marker)
      expect(result.created.probeId).toBe(probeId)
      expect(result.created.label).toBe("runtime action workflow")
      expect(result.created.execution.inWorkflow).toBe(true)
      expect(result.created.execution.inStep).toBe(true)
      expect(result.created.execution.workflowRunId).toBe(run.runId)
      expect(result.created.execution.stepId).toBeTruthy()
      expect(result.created.normalizedExecution.inWorkflow).toBe(true)
      expect(result.created.normalizedExecution.inStep).toBe(true)
      expect(result.created.normalizedExecution.workflowRunId).toBe(run.runId)
      expect(result.created.normalizedExecution.stepId).toBe(result.created.execution.stepId)

      expect(result.read.isRuntimeInstance).toBe(true)
      expect(result.read.runtimeKey).toBe(runtime.key())
      expect(result.read.marker).toBe(runtime.env.marker)
      expect(result.read.probeId).toBe(probeId)
      expect(result.read.label).toBe("runtime action workflow")
      expect(result.read.execution.inWorkflow).toBe(true)
      expect(result.read.execution.inStep).toBe(true)
      expect(result.read.execution.workflowRunId).toBe(run.runId)
      expect(result.read.execution.stepId).toBeTruthy()

      const db = await runtime.db()
      const snapshot = await db.query({
        runtime_probe_rows: {
          $: { where: { probeId }, limit: 1 },
        },
      })

      const row = snapshot.runtime_probe_rows?.[0]
      expect(row?.probeId).toBe(probeId)
      expect(row?.label).toBe("runtime action workflow")
    },
    5 * 60 * 1000,
  )

  it(
    "runs runtime.use(domain).actions through step-safe actions and keeps nested composition in-process",
    async () => {
      const runtime = new RuntimeWorkflowTestRuntime({
        appId,
        adminToken,
        marker: `runtime-marker-scoped-${Date.now()}`,
      })
      const probeId = `probe-scoped-${Date.now()}`
      const label = "  scoped workflow action  "

      const run = await start(scopedDomainActionsWorkflow, [
        runtime,
        { probeId, label },
      ])

      const result = await run.returnValue

      expect(result.rootRuntimeKey).toBe(runtime.key())
      expect(result.rootMarker).toBe(runtime.env.marker)

      expect(result.created.isRuntimeInstance).toBe(true)
      expect(result.created.runtimeKey).toBe(runtime.key())
      expect(result.created.marker).toBe(runtime.env.marker)
      expect(result.created.probeId).toBe(probeId)
      expect(result.created.label).toBe("scoped workflow action")
      expect(result.created.execution.inWorkflow).toBe(true)
      expect(result.created.execution.inStep).toBe(true)
      expect(result.created.execution.workflowRunId).toBe(run.runId)
      expect(result.created.execution.stepId).toBeTruthy()
      expect(result.created.normalizedExecution.inWorkflow).toBe(true)
      expect(result.created.normalizedExecution.inStep).toBe(true)
      expect(result.created.normalizedExecution.workflowRunId).toBe(run.runId)
      expect(result.created.normalizedExecution.stepId).toBe(result.created.execution.stepId)

      expect(result.read.probeId).toBe(probeId)
      expect(result.read.label).toBe("scoped workflow action")
      expect(result.read.execution.inWorkflow).toBe(true)
      expect(result.read.execution.inStep).toBe(true)
      expect(result.read.execution.workflowRunId).toBe(run.runId)
      expect(result.read.execution.stepId).toBeTruthy()
      expect(result.read.execution.stepId).not.toBe(result.created.execution.stepId)
    },
    5 * 60 * 1000,
  )
})

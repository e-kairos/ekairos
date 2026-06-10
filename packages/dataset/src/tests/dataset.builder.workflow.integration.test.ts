/* @vitest-environment node */

import path from "node:path"
import { readFile, readdir } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { start } from "workflow/api"

import {
  datasetAgentDurableResolutionWorkflow,
  datasetDirectObjectWorkflow,
  datasetDirectRowsAsResourceWorkflow,
  datasetDirectRowsWorkflow,
  datasetFileBuilderWorkflow,
  datasetQueryBuilderWorkflow,
  DatasetWorkflowTestRuntime,
} from "./workflow/dataset.workflow-fixtures.ts"
import { resolveDatasetAgentDurable } from "../builder/materialize.ts"

async function readWorkflowSteps(runId: string): Promise<Array<Record<string, any>>> {
  const stepsDir = path.resolve(process.cwd(), ".workflow-data", "steps")
  const files = await readdir(stepsDir).catch(() => [])
  const stepFiles = files.filter((entry) => entry.startsWith(`${runId}-`))
  const steps = await Promise.all(
    stepFiles.map(async (fileName) =>
      JSON.parse(await readFile(path.resolve(stepsDir, fileName), "utf8")),
    ),
  )
  return steps.sort(
    (a, b) =>
      Date.parse(String(a.createdAt ?? "")) -
      Date.parse(String(b.createdAt ?? "")),
  )
}

function stepFunctionNames(steps: Array<Record<string, any>>) {
  return steps.map((step) => {
    const parts = String(step.stepName ?? "").split("//")
    return parts[parts.length - 1] ?? ""
  })
}

async function withLocalDatasetSandbox<T>(fn: () => Promise<T>): Promise<T> {
  const previousLocalSandbox = process.env.DATASET_TEST_LOCAL_SANDBOX
  const previousWorkdirBase = process.env.DATASET_SANDBOX_WORKDIR_BASE
  process.env.DATASET_TEST_LOCAL_SANDBOX = "1"
  process.env.DATASET_SANDBOX_WORKDIR_BASE = path.resolve(
    process.cwd(),
    "test-results",
    "dataset-workflow-sandbox",
  )

  try {
    return await fn()
  } finally {
    if (previousLocalSandbox === undefined) {
      delete process.env.DATASET_TEST_LOCAL_SANDBOX
    } else {
      process.env.DATASET_TEST_LOCAL_SANDBOX = previousLocalSandbox
    }
    if (previousWorkdirBase === undefined) {
      delete process.env.DATASET_SANDBOX_WORKDIR_BASE
    } else {
      process.env.DATASET_SANDBOX_WORKDIR_BASE = previousWorkdirBase
    }
  }
}

async function getWorkflowDatasetSnapshot(runtime: DatasetWorkflowTestRuntime, datasetId: string) {
  const db = await (runtime as any).db()
  const query: any = await db.query({
    dataset_datasets: {
      $: { where: { datasetId } as any, limit: 1 },
      dataFile: {},
      records: {},
    } as any,
  })
  return query.dataset_datasets?.[0] ?? null
}

describe("dataset builder workflow integration", () => {
  it("flattens internal dataset agents when already running in a workflow", async () => {
    await expect(resolveDatasetAgentDurable(true)).resolves.toBe(true)

    const run = await start(datasetAgentDurableResolutionWorkflow, [])
    await expect(run.returnValue).resolves.toBe(false)
  })

  it("runs query builder from a workflow without direct DB access outside steps", async () => {
    const runtime = new DatasetWorkflowTestRuntime({
      orgId: "org_dataset_workflow",
      dbKey: `dataset-workflow-${Date.now()}`,
      requireStepDb: true,
      resourceRows: [
        { id: "item_a", sku: "SKU-A", qty: 2 },
        { id: "item_b", sku: "SKU-B", qty: 5 },
      ],
    })

    const run = await start(datasetQueryBuilderWorkflow, [
      {
        runtime,
        datasetId: "dataset_workflow_query_builder",
      },
    ])
    const result = await run.returnValue

    expect(result.datasetId).toBe("dataset_workflow_query_builder")
    expect(result.previewRows).toEqual([
      { id: "item_a", sku: "SKU-A", qty: 2 },
      { id: "item_b", sku: "SKU-B", qty: 5 },
    ])
    expect(result.readRows).toEqual(result.previewRows)
  })

  it("completes an object-mode transform with direct records inside workflow", async () => {
    await withLocalDatasetSandbox(async () => {
      const runtime = new DatasetWorkflowTestRuntime({
        orgId: "org_dataset_workflow_direct_object",
        dbKey: `dataset-workflow-direct-object-${Date.now()}`,
        requireStepDb: true,
        resourceRows: [],
      })

      const run = await start(datasetDirectObjectWorkflow, [
        {
          runtime,
          datasetId: "dataset_workflow_direct_object",
        },
      ])
      const result = await run.returnValue
      const steps = await readWorkflowSteps(String(run.runId))
      const functionNames = stepFunctionNames(steps)
      const snapshot = await getWorkflowDatasetSnapshot(runtime, result.datasetId)

      expect(result.object).toEqual({
        status: "passed",
        score: 91,
        justification: "Evidence satisfies the technical criterion.",
      })
      expect(result.previewRows).toEqual([result.object])
      expect(result.readRows).toEqual([result.object])
      expect(Array.isArray(snapshot?.records) ? snapshot.records.length : 0).toBe(1)
      expect(snapshot?.dataFile ?? null).toBeNull()
      expect(functionNames).toContain("persistDatasetRowsStep")
      expect(functionNames).not.toContain("persistDatasetStep")
    })
  })

  it("completes row-mode transform with direct records inside workflow", async () => {
    await withLocalDatasetSandbox(async () => {
      const runtime = new DatasetWorkflowTestRuntime({
        orgId: "org_dataset_workflow_direct_rows",
        dbKey: `dataset-workflow-direct-rows-${Date.now()}`,
        requireStepDb: true,
        resourceRows: [],
      })

      const run = await start(datasetDirectRowsWorkflow, [
        {
          runtime,
          datasetId: "dataset_workflow_direct_rows",
        },
      ])
      const result = await run.returnValue
      const steps = await readWorkflowSteps(String(run.runId))
      const functionNames = stepFunctionNames(steps)
      const snapshot = await getWorkflowDatasetSnapshot(runtime, result.datasetId)

      expect(result.previewRows).toEqual([
        { sku: "A1", eligible: true },
        { sku: "B2", eligible: false },
      ])
      expect(result.readRows).toEqual(result.previewRows)
      expect(Array.isArray(snapshot?.records) ? snapshot.records.length : 0).toBe(2)
      expect(snapshot?.dataFile ?? null).toBeNull()
      expect(functionNames).toContain("persistDatasetRowsStep")
      expect(functionNames).not.toContain("persistDatasetStep")
    })
  })

  it("uses direct-record datasets as transform resources without a persisted dataFile", async () => {
    await withLocalDatasetSandbox(async () => {
      const runtime = new DatasetWorkflowTestRuntime({
        orgId: "org_dataset_workflow_direct_resource",
        dbKey: `dataset-workflow-direct-resource-${Date.now()}`,
        requireStepDb: true,
        resourceRows: [],
      })

      const run = await start(datasetDirectRowsAsResourceWorkflow, [
        {
          runtime,
          datasetId: "dataset_workflow_direct_rows_resource",
        },
      ])
      const result = await run.returnValue
      const sourceSnapshot = await getWorkflowDatasetSnapshot(runtime, result.sourceDatasetId)
      const targetSnapshot = await getWorkflowDatasetSnapshot(runtime, result.datasetId)

      expect(result.previewRows).toEqual([
        { sku: "A1", eligible: true },
        { sku: "B2", eligible: false },
      ])
      expect(result.readRows).toEqual(result.previewRows)
      expect(Array.isArray(sourceSnapshot?.records) ? sourceSnapshot.records.length : 0).toBe(2)
      expect(sourceSnapshot?.dataFile ?? null).toBeNull()
      expect(Array.isArray(targetSnapshot?.records) ? targetSnapshot.records.length : 0).toBe(2)
      expect(targetSnapshot?.dataFile ?? null).toBeNull()
    })
  })

  it("prepares file dataset resources through semantic workflow steps before the context reaction", async () => {
    const previousLocalSandbox = process.env.DATASET_TEST_LOCAL_SANDBOX
    const previousWorkdirBase = process.env.DATASET_SANDBOX_WORKDIR_BASE
    process.env.DATASET_TEST_LOCAL_SANDBOX = "1"
    process.env.DATASET_SANDBOX_WORKDIR_BASE = path.resolve(
      process.cwd(),
      "test-results",
      "dataset-workflow-sandbox",
    )

    try {
      const runtime = new DatasetWorkflowTestRuntime({
        orgId: "org_dataset_workflow_file",
        dbKey: `dataset-workflow-file-${Date.now()}`,
        requireStepDb: true,
        resourceRows: [],
      })
      const db = await (runtime as any).db()
      const upload = await db.storage.uploadFile(
        `/tests/dataset/${Date.now()}-workflow-file.csv`,
        Buffer.from("code,qty\nA1,2\nB2,5\n", "utf8"),
        {
          contentType: "text/csv",
          contentDisposition: "workflow-file.csv",
        },
      )
      const fileId = String(upload?.data?.id ?? "")
      expect(fileId).toBeTruthy()

      const run = await start(datasetFileBuilderWorkflow, [
        {
          runtime,
          datasetId: "dataset_workflow_file_builder",
          fileId,
          sandboxId: "dataset-workflow-file-sandbox",
        },
      ])
      const result = await run.returnValue
      const steps = await readWorkflowSteps(String(run.runId))
      const functionNames = stepFunctionNames(steps)

      expect(result.previewRows).toEqual([
        { code: "A1", qty: 2 },
        { code: "B2", qty: 5 },
      ])
      const stepIndex = (name: string) => functionNames.indexOf(name)
      expect(stepIndex("createDatasetResourceContextStep")).toBeGreaterThanOrEqual(0)
      expect(stepIndex("initializeDatasetStep")).toBeGreaterThan(stepIndex("createDatasetResourceContextStep"))
      expect(stepIndex("prepareDatasetResourcesStep")).toBeGreaterThan(stepIndex("initializeDatasetStep"))
      expect(stepIndex("readInstantFileStep")).toBeGreaterThan(stepIndex("prepareDatasetResourcesStep"))
      expect(stepIndex("writeDatasetSandboxFilesStep")).toBeGreaterThan(stepIndex("readInstantFileStep"))
      expect(stepIndex("initializeDatasetContextStep")).toBeGreaterThan(stepIndex("writeDatasetSandboxFilesStep"))
      expect(functionNames).toContain("completeDatasetStep")
      expect(functionNames).toContain("initializeFileParseSandboxStep")
      expect(functionNames.filter((name) => name === "runDatasetSandboxCommandStep").length).toBeLessThanOrEqual(3)
      expect(functionNames.length).toBeLessThanOrEqual(35)
    } finally {
      if (previousLocalSandbox === undefined) {
        delete process.env.DATASET_TEST_LOCAL_SANDBOX
      } else {
        process.env.DATASET_TEST_LOCAL_SANDBOX = previousLocalSandbox
      }
      if (previousWorkdirBase === undefined) {
        delete process.env.DATASET_SANDBOX_WORKDIR_BASE
      } else {
        process.env.DATASET_SANDBOX_WORKDIR_BASE = previousWorkdirBase
      }
    }
  })
})

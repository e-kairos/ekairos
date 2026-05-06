/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { start } from "workflow/api"

import {
  datasetAgentDurableResolutionWorkflow,
  datasetQueryBuilderWorkflow,
  DatasetWorkflowTestRuntime,
} from "./workflow/dataset.workflow-fixtures.ts"
import { resolveDatasetAgentDurable } from "../builder/materialize.ts"

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
      sourceRows: [
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
})

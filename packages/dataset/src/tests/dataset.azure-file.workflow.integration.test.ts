/* @vitest-environment node */

import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { config as dotenvConfig } from "dotenv"
import { init } from "@instantdb/admin"
import { configureRuntime } from "@ekairos/domain/runtime"
import { SandboxService } from "@ekairos/sandbox/service"
import { start } from "workflow/api"
import { describe, expect, it } from "vitest"

import {
  datasetAzureFileWorkflowRepro,
  datasetAzureWorkflowReproDomain,
  DatasetAzureWorkflowReproRuntime,
} from "./workflow/dataset.azure-workflow-repro.ts"
import {
  createTestApp,
  destroyTestApp,
} from "../../../ekairos-test/src/provision.ts"

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..")
const workspaceRoot = path.resolve(repoRoot, "..")
const esolbayRoot = path.resolve(
  workspaceRoot,
  "client",
  "esolbay",
  "esolbay-platform",
)
const esolbayEnvPath = path.resolve(esolbayRoot, ".env.local")

dotenvConfig({ path: esolbayEnvPath, quiet: true })
dotenvConfig({ path: path.resolve(repoRoot, ".env.local"), quiet: true })
dotenvConfig({ path: path.resolve(repoRoot, ".env"), quiet: true })

const TEST_TIMEOUT_MS = 20 * 60 * 1000
const DAYTONA_NO_AVAILABLE_RUNNERS_RETRY_DELAYS_MS = [1_000, 2_500, 5_000, 10_000] as const

function readTrimmedEnv(name: string): string {
  return String(process.env[name] ?? "").trim()
}

function hasAzureResponsesEnv(): boolean {
  return Boolean(
    (readTrimmedEnv("AZURE_API_KEY") ||
      readTrimmedEnv("AZURE_OPENAI_API_KEY")) &&
      (readTrimmedEnv("AZURE_OPENAI_ENDPOINT") ||
        readTrimmedEnv("AZURE_RESOURCE_NAME")),
  )
}

function hasReproEnv(): boolean {
  return Boolean(
    readTrimmedEnv("EKAIROS_DATASET_AZURE_WORKFLOW_REPRO") === "1" &&
      hasAzureResponsesEnv() &&
      (readTrimmedEnv("DAYTONA_API_URL") || readTrimmedEnv("DAYTONA_SERVER_URL")) &&
      readTrimmedEnv("DAYTONA_API_KEY") &&
      readTrimmedEnv("INSTANT_PERSONAL_ACCESS_TOKEN"),
  )
}

function getInstantProvisionToken(): string {
  const token = readTrimmedEnv("INSTANT_PERSONAL_ACCESS_TOKEN")
  if (!token) {
    throw new Error("INSTANT_PERSONAL_ACCESS_TOKEN is required")
  }
  return token
}

function createCsvFixture(): Buffer {
  return Buffer.from(
    [
      "code,name,quantity,unitOfMeasure",
      "REQ-001,Notebook Lenovo ThinkPad,2,unit",
      "REQ-002,Monitor 27 pulgadas,4,unit",
      "REQ-003,Mouse inalambrico,6,unit",
      "",
    ].join("\n"),
    "utf8",
  )
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function isDaytonaNoAvailableRunnersError(error: unknown) {
  return String(error instanceof Error ? error.message : error ?? "")
    .toLowerCase()
    .includes("no available runners")
}

async function createDaytonaSandbox(params: {
  db: any
  runtime: DatasetAzureWorkflowReproRuntime
  datasetId: string
  fileId: string
}) {
  const service = new SandboxService(params.db as any)
  const snapshot = String(process.env.DATASET_DAYTONA_SNAPSHOT_NAME ?? "").trim()
  const maxAttempts = DAYTONA_NO_AVAILABLE_RUNNERS_RETRY_DELAYS_MS.length + 1

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const createdSandbox = await service.createSandbox({
        provider: "daytona",
        runtime: "python3.13",
        timeoutMs: 20 * 60 * 1000,
        resources: { vcpus: 2 },
        purpose: "dataset.azure.workflow.repro",
        daytona: {
          language: "python",
          ...(snapshot ? { snapshot } : {}),
          ephemeral: true,
          autoStopIntervalMin: 5,
          volumes: [],
          labels: {
            ekairos_dataset: "1",
            azure_workflow_repro: "1",
          },
        },
        params: {
          orgId: params.runtime.env.orgId,
          datasetId: params.datasetId,
          fileId: params.fileId,
          datasetProvider: "daytona",
          ...(snapshot ? { daytonaSnapshotName: snapshot } : {}),
        },
      })
      if (!createdSandbox.ok) throw new Error(createdSandbox.error)
      return createdSandbox.data.sandboxId
    } catch (error) {
      if (!isDaytonaNoAvailableRunnersError(error) || attempt >= maxAttempts) throw error
      await wait(DAYTONA_NO_AVAILABLE_RUNNERS_RETRY_DELAYS_MS[attempt - 1])
    }
  }

  throw new Error("Dataset Daytona sandbox creation exhausted runner retries.")
}

async function readWorkflowRunFile(runId: string): Promise<Record<string, any>> {
  const runsDir = path.resolve(process.cwd(), ".workflow-data", "runs")
  const files = await readdir(runsDir).catch(() => [])
  const fileName = files.find((entry) => entry.startsWith(`${runId}.`))
  if (!fileName) return {}
  return JSON.parse(await readFile(path.resolve(runsDir, fileName), "utf8"))
}

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

function summarizeStepNames(steps: Array<Record<string, any>>) {
  const counts: Record<string, number> = {}
  for (const step of steps) {
    const name = String(step.stepName ?? "")
    counts[name] = (counts[name] ?? 0) + 1
  }
  return counts
}

async function writeReproReport(report: Record<string, unknown>) {
  const reportDir = path.resolve(process.cwd(), ".ekairos", "reports")
  await mkdir(reportDir, { recursive: true })
  const reportPath = path.resolve(
    reportDir,
    `dataset-azure-workflow-repro-${Date.now()}.json`,
  )
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8")
  console.log(`[dataset-azure-workflow-repro] ${reportPath}`)
  return reportPath
}

const describeRepro = hasReproEnv() ? describe : describe.skip

describeRepro("dataset Azure file workflow repro", () => {
  it(
    "captures current parent workflow step fan-out for file dataset materialization",
    async () => {
      const app = await createTestApp({
        name: `dataset-azure-workflow-repro-${Date.now()}`,
        token: getInstantProvisionToken(),
        schema: datasetAzureWorkflowReproDomain.toInstantSchema(),
      })
      const runtime = new DatasetAzureWorkflowReproRuntime({
        orgId: "dataset-azure-workflow-repro-org",
        appId: app.appId,
        adminToken: app.adminToken,
      })
      const db = init({
        appId: app.appId,
        adminToken: app.adminToken,
        schema: datasetAzureWorkflowReproDomain.toInstantSchema(),
        useDateObjects: true,
      } as any)
      configureRuntime({
        domain: { domain: datasetAzureWorkflowReproDomain },
        runtime: async () => ({ db } as any),
      })

      const service = new SandboxService(db as any)
      const persist = readTrimmedEnv("EKAIROS_DATASET_REPRO_PERSIST") === "1"
      let sandboxId = ""

      try {
        const uploaded = await db.storage.uploadFile(
          `/tests/dataset/${Date.now()}-requisition-items.csv`,
          createCsvFixture(),
          {
            contentType: "text/csv",
            contentDisposition: "requisition-items.csv",
          },
        )
        const fileId = String(uploaded?.data?.id ?? "")
        expect(fileId).toBeTruthy()

        const datasetId = `dataset_azure_workflow_repro_${randomUUID()}`
        sandboxId = await createDaytonaSandbox({
          db,
          runtime,
          datasetId,
          fileId,
        })
        const startedAt = Date.now()
        const run = await start(datasetAzureFileWorkflowRepro, [
          {
            runtime,
            datasetId,
            fileId,
            sandboxId,
          },
        ])
        const result = await run.returnValue
        const totalDurationMs = Date.now() - startedAt
        const datasetSnapshot = await db.query({
          dataset_datasets: {
            $: { where: { datasetId: result.datasetId }, limit: 1 },
            context: {},
          } as any,
        })
        const datasetRow = datasetSnapshot.dataset_datasets?.[0]
        const context = datasetRow?.context

        const workflowRunId = String(run.runId)
        const runFile = await readWorkflowRunFile(workflowRunId)
        const steps = await readWorkflowSteps(workflowRunId)
        const stepNameCounts = summarizeStepNames(steps)
        const commandStepCount =
          stepNameCounts[
            "step//./src/sandbox/steps//runDatasetSandboxCommandStep"
          ] ?? 0
        const reportPath = await writeReproReport({
          appId: app.appId,
          datasetId: result.datasetId,
          contextId: context?.id,
          contextSourceKinds: context?.content?.sources?.map((source: any) => source.kind),
          sandboxId,
          fileId,
          workflowRunId,
          workflowName: runFile.workflowName,
          totalDurationMs,
          datasetBuildDurationMs: result.datasetBuildDurationMs,
          rowCount: result.rowCount,
          rows: result.rows,
          parentWorkflowStepCount: steps.length,
          runDatasetSandboxCommandStepCount: commandStepCount,
          stepNameCounts,
          stepNames: steps.map((step) => step.stepName),
          preserved: persist,
        })

        expect(result.datasetId).toBe(datasetId)
        expect(result.workflowRunId).toBe(workflowRunId)
        expect(result.rowCount).toBeGreaterThan(0)
        expect(datasetRow?.resourceKinds).toBeUndefined()
        expect(context?.id).toBeTruthy()
        expect(context?.content?.sources?.map((source: any) => source.kind)).toEqual(["file"])
        expect(steps.length).toBeGreaterThan(0)
        expect(reportPath).toContain("dataset-azure-workflow-repro")
      } finally {
        try {
          if (!persist && sandboxId) {
            const stopped = await service.stopSandbox(sandboxId)
            if (!stopped.ok) throw new Error(stopped.error)
          }
          if (!persist) {
            await destroyTestApp({
              appId: app.appId,
              token: getInstantProvisionToken(),
            }).catch(() => {})
          }
        } catch {
          // Best-effort cleanup; repro artifacts are reported separately.
        }
      }
    },
    TEST_TIMEOUT_MS,
  )
})

/* @vitest-environment node */

import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { domain } from "@ekairos/domain"
import { i } from "@instantdb/core"
import { config as dotenvConfig } from "dotenv"
import { init } from "@instantdb/admin"
import { start } from "workflow/api"
import { describe, expect, it } from "vitest"
import {
  createTestApp,
  destroyTestApp,
} from "../../../ekairos-test/src/provision.ts"

import {
  esolbayAwardDatasetWorkflowReproDomain,
  esolbayAwardDatasetOperationWorkflow,
  EsolbayAwardDatasetWorkflowReproRuntime,
} from "./workflow/dataset.esolbay-award.workflow-repro.ts"

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..")
const workspaceRoot = path.resolve(repoRoot, "..")
const esolbayRoot = path.resolve(
  workspaceRoot,
  "client",
  "esolbay",
  "esolbay-platform",
)
const esolbayEnvPath = path.resolve(esolbayRoot, ".env.local")
const esolbayVercelProjectPath = path.resolve(
  esolbayRoot,
  ".vercel",
  "project.json",
)
const fixturesDir = path.resolve(
  __dirname,
  "fixtures",
  "esolbay-award-dataset-runs",
)

dotenvConfig({ path: esolbayEnvPath, quiet: true })
dotenvConfig({ path: path.resolve(repoRoot, ".env.local"), quiet: true })
dotenvConfig({ path: path.resolve(repoRoot, ".env"), quiet: true })

const TEST_TIMEOUT_MS = 45 * 60 * 1000

const platformDomain = domain("platform").schema({
  entities: {
    platform_instantCredentials: i.entity({
      clerkOrgId: i.string().unique().indexed(),
      appId: i.string().indexed(),
      adminToken: i.string(),
      createdAt: i.date().optional().indexed(),
      updatedAt: i.date().optional().indexed(),
    }),
  },
  links: {},
  rooms: {},
})

type RunFixtureInput = {
  orgId: string
  fileId: string
  datasetId: string
  instructions: string
  outputSchema: any
}

type RunFixture = {
  runId: string
  workflowName: string
  input: [RunFixtureInput]
}

type ReproCase = {
  name: string
  fixtureFileName: string
}

const cases: ReproCase[] = [
  { name: "roberto", fixtureFileName: "roberto-run.json" },
  { name: "provider2", fixtureFileName: "provider2-run.json" },
]

function readTrimmedEnv(name: string): string {
  return String(process.env[name] ?? "").trim()
}

function getRequiredEnv(name: string): string {
  const value = readTrimmedEnv(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function getInstantProvisionToken() {
  return getRequiredEnv("INSTANT_PERSONAL_ACCESS_TOKEN")
}

async function copyCapturedFile(params: {
  source: { appId: string; adminToken: string }
  target: { appId: string; adminToken: string }
  fileId: string
}) {
  const sourceDb = init({
    appId: params.source.appId,
    adminToken: params.source.adminToken,
    useDateObjects: true,
  } as any)
  const sourceResult = await sourceDb.query({
    $files: {
      $: { where: { id: params.fileId }, limit: 1 },
    },
  } as any)
  const sourceFile = sourceResult.$files?.[0] as Record<string, unknown> | undefined
  const url = typeof sourceFile?.url === "string" ? sourceFile.url : ""
  if (!sourceFile || !url) throw new Error(`Captured Esolbay file not found: ${params.fileId}`)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Captured Esolbay file download failed: ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const name = String(sourceFile.name ?? sourceFile.filename ?? "captured-file")
  const contentType = String(
    sourceFile["content-type"] ?? sourceFile.contentType ?? response.headers.get("content-type") ?? "application/octet-stream",
  )
  const targetDb = init({
    appId: params.target.appId,
    adminToken: params.target.adminToken,
    schema: esolbayAwardDatasetWorkflowReproDomain.toInstantSchema(),
    useDateObjects: true,
  } as any)
  const uploaded = await targetDb.storage.uploadFile(
    `/tests/esolbay-award/${Date.now()}-${name}`,
    bytes,
    { contentType, contentDisposition: name },
  )
  const fileId = String(uploaded?.data?.id ?? "")
  if (!fileId) throw new Error("Captured Esolbay file copy did not return an id")
  return { fileId, name, contentType, size: bytes.byteLength }
}

async function loadRunFixture(fileName: string): Promise<RunFixture> {
  const raw = await readFile(path.resolve(fixturesDir, fileName), "utf8")
  const parsed = JSON.parse(raw) as RunFixture
  const input = parsed.input?.[0]
  if (!parsed.runId || !input?.orgId || !input?.fileId || !input?.datasetId) {
    throw new Error(`Invalid Esolbay award dataset run fixture: ${fileName}`)
  }
  if (!input.instructions || !input.outputSchema) {
    throw new Error(`Fixture is missing instructions/outputSchema: ${fileName}`)
  }
  return parsed
}

async function readEsolbayVercelProject() {
  const raw = await readFile(esolbayVercelProjectPath, "utf8")
  const parsed = JSON.parse(raw) as {
    orgId?: string
    projectId?: string
    projectName?: string
  }
  if (!parsed.orgId || !parsed.projectId) {
    throw new Error("Esolbay .vercel/project.json is missing orgId/projectId")
  }
  return parsed
}

async function resolveOrgCredentials(clerkOrgId: string) {
  const db = init({
    appId: getRequiredEnv("PLATFORM_INSTANT_APP_ID"),
    adminToken: getRequiredEnv("PLATFORM_INSTANT_APP_ADMIN_TOKEN"),
    schema: platformDomain.toInstantSchema(),
    useDateObjects: true,
  } as any)
  const result = await db.query({
    platform_instantCredentials: {
      $: { where: { clerkOrgId }, limit: 1 },
    },
  })
  const record = result.platform_instantCredentials?.[0] as
    | { appId?: string; adminToken?: string }
    | undefined
  const appId = String(record?.appId ?? "").trim()
  const adminToken = String(record?.adminToken ?? "").trim()
  if (!appId || !adminToken) {
    throw new Error(`InstantDB credentials not found for organization ${clerkOrgId}`)
  }
  return { appId, adminToken }
}

function createReproDatasetId(caseName: string, originalDatasetId: string) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  return `${originalDatasetId}__${caseName}_repro_${suffix}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  )
}

function setTemporaryEnv(values: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>()
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name])
    process.env[name] = value
  }

  return () => {
    for (const [name, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  }
}

function clearLocalVercelRuntimeEnv(): () => void {
  const names = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_OIDC_TOKEN"]
  const previous = new Map<string, string | undefined>()
  for (const name of names) {
    previous.set(name, process.env[name])
    delete process.env[name]
  }

  return () => {
    for (const [name, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  }
}

async function configureVercelSandboxEnv() {
  const vercelProject = await readEsolbayVercelProject()
  const restoreRuntimeEnv = clearLocalVercelRuntimeEnv()
  const restoreSandboxEnv = setTemporaryEnv({
    SANDBOX_VERCEL_CWD: esolbayRoot,
    SANDBOX_VERCEL_TEAM_ID: vercelProject.orgId,
    SANDBOX_VERCEL_PROJECT_ID: vercelProject.projectId,
    SANDBOX_VERCEL_PROFILE: "ephemeral",
    SANDBOX_VERCEL_DELETE_ON_STOP: "true",
    SANDBOX_VERCEL_TIMEOUT_MS: String(20 * 60 * 1000),
    SANDBOX_VERCEL_VCPUS: "2",
  })
  return () => {
    restoreSandboxEnv()
    restoreRuntimeEnv()
  }
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
    `dataset-esolbay-award-workflow-repro-${Date.now()}.json`,
  )
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8")
  console.log(`[dataset-esolbay-award-workflow-repro] ${reportPath}`)
  return reportPath
}

const describeEsolbayRepro = process.env.RUN_ESOLBAY_AWARD_DATASET_REPRO === "1"
  ? describe
  : describe.skip

describeEsolbayRepro("Esolbay award dataset workflow repro", () => {
  it.each(cases)(
    "runs the exact captured dataset operation for $name",
    async (reproCase) => {
      const fixture = await loadRunFixture(reproCase.fixtureFileName)
      const captured = fixture.input[0]
      const sourceCredentials = await resolveOrgCredentials(captured.orgId)
      const app = await createTestApp({
        name: `dataset-esolbay-award-repro-${reproCase.name}-${Date.now()}`,
        token: getInstantProvisionToken(),
        schema: esolbayAwardDatasetWorkflowReproDomain.toInstantSchema(),
      })
      let restoreVercelEnv = () => {}

      try {
        const copiedFile = await copyCapturedFile({
          source: sourceCredentials,
          target: app,
          fileId: captured.fileId,
        })
        const runtime = new EsolbayAwardDatasetWorkflowReproRuntime({
          orgId: captured.orgId,
          appId: app.appId,
          adminToken: app.adminToken,
        })
        const datasetId = createReproDatasetId(reproCase.name, captured.datasetId)
        restoreVercelEnv = await configureVercelSandboxEnv()
        const startedAt = Date.now()
        const run = await start(esolbayAwardDatasetOperationWorkflow, [
          {
            runtime,
            orgId: captured.orgId,
            originalWorkflowRunId: fixture.runId,
            originalDatasetId: captured.datasetId,
            datasetId,
            fileId: copiedFile.fileId,
            instructions: captured.instructions,
            outputSchema: captured.outputSchema,
          },
        ])
        const result = await run.returnValue
        const totalDurationMs = Date.now() - startedAt
        const workflowRunId = String(run.runId)
        const runFile = await readWorkflowRunFile(workflowRunId)
        const steps = await readWorkflowSteps(workflowRunId)
        const stepNameCounts = summarizeStepNames(steps)
        const reportPath = await writeReproReport({
          caseName: reproCase.name,
          originalWorkflowRunId: fixture.runId,
          originalWorkflowName: fixture.workflowName,
          originalDatasetId: captured.datasetId,
          datasetId: result.datasetId,
          orgId: captured.orgId,
          sourceFileId: captured.fileId,
          copiedFile,
          appId: app.appId,
          workflowRunId,
          workflowName: runFile.workflowName,
          totalDurationMs,
          datasetBuildDurationMs: result.datasetBuildDurationMs,
          rowCount: result.rowCount,
          previewRows: result.previewRows,
          parentWorkflowStepCount: steps.length,
          stepNameCounts,
          stepNames: steps.map((step) => step.stepName),
        })

        expect(result.datasetId).toBe(datasetId)
        expect(result.originalDatasetId).toBe(captured.datasetId)
        expect(result.workflowRunId).toBe(workflowRunId)
        expect(result.rowCount).toBeGreaterThan(0)
        expect(steps.length).toBeGreaterThan(0)
        expect(reportPath).toContain("dataset-esolbay-award-workflow-repro")
      } finally {
        restoreVercelEnv()
        await destroyTestApp({
          appId: app.appId,
          token: getInstantProvisionToken(),
        }).catch(() => {})
      }
    },
    TEST_TIMEOUT_MS,
  )
})

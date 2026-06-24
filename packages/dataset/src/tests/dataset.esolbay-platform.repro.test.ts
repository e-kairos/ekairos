import { afterAll, describe, expect, it } from "vitest"
import { config as dotenvConfig } from "dotenv"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { init } from "@instantdb/admin"
import { domain } from "@ekairos/domain"
import { EkairosRuntime, configureRuntime } from "@ekairos/domain/runtime"
import { eventsDomain } from "@ekairos/events"
import { createScriptedReactor } from "@ekairos/reactor/context"
import { sandboxDomain, SandboxService } from "@ekairos/sandbox"

import { dataset } from "../dataset"
import {
  readDatasetSandboxTextFileStep,
  runDatasetSandboxCommandStep,
} from "../sandbox/steps"
import { datasetDomain } from "../schema"

const shouldRun = process.env.RUN_ESOLBAY_DATASET_REPRO === "1"
const maybeDescribe = shouldRun ? describe : describe.skip

const workspaceRoot = path.resolve(__dirname, "..", "..", "..", "..", "..")
const esolbayEnvFile =
  process.env.ESOLBAY_ENV_FILE ??
  path.resolve(workspaceRoot, "client", "esolbay", "esolbay-platform", ".env.vercel.development")

dotenvConfig({ path: esolbayEnvFile })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

const DEFAULT_ESOLBAY_APP_ID = "76229f35-401e-4e9b-a7ce-2ed6bc03a662"
const DAYTONA_NO_AVAILABLE_RUNNERS_RETRY_DELAYS_MS = [1_000, 2_500, 5_000, 10_000] as const

const appDomain = domain("dataset-esolbay-platform-repro")
  .includes(datasetDomain)
  .includes(sandboxDomain)
  .includes(eventsDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

type TestEnv = Record<string, unknown> & {
  orgId: string
}

function requiredEnv(name: string) {
  const value = String(process.env[name] ?? "").trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function resolveAppId() {
  return String(process.env.ESOLBAY_DATASET_REPRO_APP_ID ?? DEFAULT_ESOLBAY_APP_ID).trim()
}

function resolveAdminToken() {
  return String(
    process.env.ESOLBAY_DATASET_REPRO_ADMIN_TOKEN ??
      process.env.ESOLBAY_DATASET_REPRO_TOKEN ??
      "",
  ).trim()
}

function assertReproEnvironment() {
  requiredEnv("DAYTONA_API_URL")
  requiredEnv("DAYTONA_API_KEY")
  if (!resolveAdminToken()) {
    throw new Error("ESOLBAY_DATASET_REPRO_ADMIN_TOKEN is required")
  }
}

const adminDb = shouldRun
  ? init({
      appId: resolveAppId(),
      adminToken: resolveAdminToken(),
      schema: appDomain.toInstantSchema(),
    } as any)
  : null

if (adminDb) {
  configureRuntime({
    domain: { domain: appDomain },
    runtime: async () => ({ db: adminDb } as any),
  })
}

class EsolbayDatasetReproRuntime extends EkairosRuntime<TestEnv, typeof appDomain, any> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return adminDb as any
  }
}

function createRuntime(orgId: string) {
  return new EsolbayDatasetReproRuntime({ orgId })
}

function scriptedToolStep(toolName: string, input: Record<string, unknown>, text = `run ${toolName}`) {
  const toolCallId = `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    assistantEvent: {
      content: {
        parts: [
          { type: "text", text },
          {
            type: `tool-${toolName}`,
            toolCallId,
            input,
          },
        ],
      },
    },
    actionRequests: [
      {
        actionRef: toolCallId,
        actionName: toolName,
        input,
      },
    ],
    messagesForModel: [],
  }
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function isDaytonaNoAvailableRunnersError(error: unknown) {
  return String(error instanceof Error ? error.message : error ?? "")
    .toLowerCase()
    .includes("no available runners")
}

async function createEsolbayStyleDaytonaSandbox(params: {
  orgId: string
  datasetId: string
}) {
  const service = new SandboxService(adminDb as any)
  const snapshot = String(process.env.DATASET_DAYTONA_SNAPSHOT_NAME ?? "").trim()
  const maxAttempts = DAYTONA_NO_AVAILABLE_RUNNERS_RETRY_DELAYS_MS.length + 1

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const created = await service.createSandbox({
        provider: "daytona",
        runtime: "python3.13",
        timeoutMs: 20 * 60 * 1000,
        resources: { vcpus: 1 },
        purpose: "dataset.esolbay-platform.repro",
        daytona: {
          language: "python",
          ...(snapshot ? { snapshot } : {}),
          ephemeral: true,
          autoStopIntervalMin: 5,
          volumes: [],
          labels: {
            esolbay_dataset: "1",
            ekairos_platform_repro: "1",
          },
        },
        params: {
          orgId: params.orgId,
          datasetId: params.datasetId,
          datasetProvider: "daytona",
          ...(snapshot ? { daytonaSnapshotName: snapshot } : {}),
        },
      })
      if (!created.ok) throw new Error(created.error)
      return created.data.sandboxId
    } catch (error) {
      if (!isDaytonaNoAvailableRunnersError(error) || attempt >= maxAttempts) throw error
      await wait(DAYTONA_NO_AVAILABLE_RUNNERS_RETRY_DELAYS_MS[attempt - 1])
    }
  }

  throw new Error("Dataset Daytona sandbox creation exhausted runner retries.")
}

async function stopSandbox(sandboxId?: string) {
  if (!sandboxId) return
  const service = new SandboxService(adminDb as any)
  await service.stopSandbox(sandboxId).catch(() => {})
}

async function uploadRequisitionItemsCsv(datasetId: string) {
  const csv = [
    "code,description,quantity,unit,expectedDate",
    "REQ-001,Motor electrico trifasico,2,unit,2026-06-01",
    "REQ-002,Tablero de control IP65,1,unit,2026-06-03",
    "REQ-003,Cable cobre 4mm,120,meter,2026-06-05",
  ].join("\n")

  const upload = await adminDb!.storage.uploadFile(
    `/tests/dataset/esolbay-repro/${datasetId}/requisition-items.csv`,
    Buffer.from(csv, "utf-8"),
    {
      contentType: "text/csv",
      contentDisposition: "requisition-items.csv",
    },
  )
  const fileId = upload?.data?.id
  if (!fileId) throw new Error("Failed to upload repro csv")
  return fileId as string
}

async function getDatasetSnapshot(datasetId: string) {
  const query: any = await adminDb!.query({
    dataset_datasets: {
      $: { where: { datasetId } as any, limit: 1 },
      dataFile: {},
    } as any,
  })
  const row = query.dataset_datasets?.[0]
  const file = Array.isArray(row?.dataFile) ? row.dataFile[0] : row?.dataFile
  if (!row || !file?.url) throw new Error(`Missing dataset output for ${datasetId}`)

  const response = await fetch(file.url)
  if (!response.ok) throw new Error(`Failed to read dataset output file: ${response.status}`)
  const rows = (await response.text())
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((record) => record?.type === "row")
    .map((record) => record.data)

  return { dataset: row, rows }
}

async function findContextId(datasetId: string) {
  const query: any = await adminDb!.query({
    event_contexts: {
      $: { where: { key: `dataset:${datasetId}` }, limit: 1 },
    },
  })
  return String(query.event_contexts?.[0]?.id ?? "")
}

async function queryEventParts(stepRows: any[]) {
  const rows: any[] = []
  for (const step of stepRows) {
    const stepId = String(step?.id ?? "")
    if (!stepId) continue
    const query: any = await adminDb!.query({
      event_parts: {
        $: {
          where: { "step.id": stepId as any },
          order: { idx: "asc" },
          limit: 100,
        },
        step: {},
      },
    } as any)
    rows.push(...(query.event_parts ?? []))
  }
  return rows
}

async function getContextInspection(contextId: string, executionId: string) {
  const snapshot: any = await adminDb!.query({
    event_contexts: {
      $: { where: { id: contextId as any }, limit: 1 },
      currentExecution: {},
    },
    event_executions: {
      $: { where: { id: executionId as any }, limit: 1 },
      context: {},
      trigger: {},
      reaction: {},
    },
    event_steps: {
      $: {
        where: { "execution.id": executionId as any },
        order: { createdAt: "asc" },
        limit: 100,
      },
      execution: {},
    },
    event_items: {
      $: {
        where: { "context.id": contextId as any },
        order: { createdAt: "asc" },
        limit: 100,
      },
      context: {},
      execution: {},
    },
  } as any)
  const stepRows = Array.isArray(snapshot.event_steps) ? snapshot.event_steps : []
  return {
    ...snapshot,
    event_parts: await queryEventParts(stepRows),
  }
}

async function inspectSandboxFilesystem(params: {
  runtime: EsolbayDatasetReproRuntime
  sandboxId: string
  contextId: string
  manifestPath?: string
  outputPath?: string
}) {
  const root = `/tmp/ekairos/contexts/${params.contextId}`
  const files = await runDatasetSandboxCommandStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    cmd: "find",
    args: [root, "-maxdepth", "8", "-type", "f", "-print"],
  })
  const manifest = params.manifestPath
    ? await readDatasetSandboxTextFileStep({
        runtime: params.runtime,
        sandboxId: params.sandboxId,
        path: params.manifestPath,
      }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
    : null
  const output = params.outputPath
    ? await readDatasetSandboxTextFileStep({
        runtime: params.runtime,
        sandboxId: params.sandboxId,
        path: params.outputPath,
      }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
    : null

  return {
    root,
    files: files.stdout
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .sort(),
    findExitCode: files.exitCode,
    manifest,
    output,
  }
}

async function writeReport(report: Record<string, unknown>) {
  const outDir = path.resolve(workspaceRoot, "ekairos-base", "test-results", "dataset-esolbay-platform-repro")
  await mkdir(outDir, { recursive: true })
  const filePath = path.join(outDir, `${report.datasetId}.json`)
  await writeFile(filePath, JSON.stringify(report, null, 2), "utf-8")
  return filePath
}

maybeDescribe("dataset Esolbay platform repro", () => {
  let sandboxId: string | undefined

  afterAll(async () => {
    await stopSandbox(sandboxId)
    sandboxId = undefined
  }, 120000)

  it("replicates a file-backed dataset context and exposes it in ekairos-platform", async () => {
    assertReproEnvironment()

    const appId = resolveAppId()
    const orgId = String(process.env.ESOLBAY_DATASET_REPRO_ORG_ID ?? "org_3DaIwaTee90o1PVIi5MKbBoU2iD").trim()
    const datasetId = `dataset-requisition-items-${Date.now()}`
    const runtime = createRuntime(orgId)
    const fileId = await uploadRequisitionItemsCsv(datasetId)
    sandboxId = await createEsolbayStyleDaytonaSandbox({ orgId, datasetId })

    const reactor = createScriptedReactor({
      steps: [
        scriptedToolStep(
          "executeCommand",
          {
            scriptName: "parse_requisition_items",
            pythonCode: [
              "import csv, json",
              "from pathlib import Path",
              "workspace = Path(__file__).resolve().parents[1]",
              "manifest = json.loads((workspace / 'manifest.json').read_text(encoding='utf-8'))",
              "source_path = manifest['files'][0]['path']",
              "output_path = str(Path(manifest['outputDir']) / 'output.jsonl')",
              "with open(source_path, 'r', encoding='utf-8') as src, open(output_path, 'w', encoding='utf-8') as out:",
              "  reader = csv.DictReader(src)",
              "  for row in reader:",
              "    payload = {",
              "      'type': 'row',",
              "      'data': {",
              "        'code': row['code'],",
              "        'description': row['description'],",
              "        'quantity': float(row['quantity']),",
              "        'unit': row['unit'],",
              "        'expectedDate': row['expectedDate'],",
              "      },",
              "    }",
              "    out.write(json.dumps(payload, ensure_ascii=False) + '\\n')",
              "print('parsed requisition items')",
            ].join("\n"),
          },
          "Parse uploaded requisition item file.",
        ),
        scriptedToolStep(
          "completeDataset",
          { summary: "Requisition item dataset completed." },
          "Complete the dataset after validating the output file.",
        ),
      ],
    })

    const result = await dataset(runtime)
      .sandbox({ sandboxId })
      .fromFile({
        fileId,
        description: "Esolbay requisition items csv",
        filename: "requisition-items.csv",
        mediaType: "text/csv",
      })
      .schema({
        title: "RequisitionItem",
        description: "One requisition item row",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: { type: "string" },
            description: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
            expectedDate: { type: "string" },
          },
          required: ["code", "description", "quantity", "unit", "expectedDate"],
        },
      })
      .instructions("Generate a dataset for this file using the provided RequisitionItem schema.")
      .reactor(reactor)
      .build({ datasetId })

    const snapshot = await getDatasetSnapshot(result.datasetId)
    const contextId = await findContextId(result.datasetId)
    const executionInspectionQuery: any = await adminDb!.query({
      event_executions: {
        $: {
          where: { "context.id": contextId as any },
          limit: 1,
        },
      },
    } as any)
    const executionId = String(executionInspectionQuery.event_executions?.[0]?.id ?? "")
    const inspection = await getContextInspection(contextId, executionId)
    const contextContent = inspection.event_contexts?.[0]?.content ?? {}
    const sandboxFs = await inspectSandboxFilesystem({
      runtime,
      sandboxId,
      contextId,
      manifestPath: contextContent?.ctx?.sandboxConfig?.manifestPath,
      outputPath: contextContent?.ctx?.sandboxConfig?.outputPath,
    })
    const contextUrl = contextId
      ? `http://localhost:5908/app/${appId}/contexts/${contextId}`
      : ""
    const reportPath = await writeReport({
      appId,
      orgId,
      datasetId: result.datasetId,
      fileId,
      sandboxId,
      contextId,
      executionId,
      contextUrl,
      status: snapshot.dataset.status,
      rowCount: snapshot.rows.length,
      rows: snapshot.rows,
      schemaTitle: snapshot.dataset.schema?.title,
      contextContent,
      inspection: {
        event_contexts: inspection.event_contexts,
        event_executions: inspection.event_executions,
        event_steps: inspection.event_steps,
        event_items: inspection.event_items,
        event_parts: inspection.event_parts,
      },
      sandboxFs,
      dataFileId: Array.isArray(snapshot.dataset.dataFile)
        ? snapshot.dataset.dataFile[0]?.id
        : snapshot.dataset.dataFile?.id,
    })

    expect(result.datasetId).toBe(datasetId)
    expect(snapshot.dataset.status).toBe("completed")
    expect(snapshot.dataset.sandboxId).toBe(sandboxId)
    expect(snapshot.dataset.schema?.title).toBe("RequisitionItem")
    expect(snapshot.rows).toHaveLength(3)
    expect(contextId).toBeTruthy()

    console.info(`[dataset esolbay repro] contextUrl=${contextUrl}`)
    console.info(`[dataset esolbay repro] report=${reportPath}`)
  }, 8 * 60 * 1000)
})

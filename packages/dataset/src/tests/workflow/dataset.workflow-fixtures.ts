import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { getStepMetadata, getWorkflowMetadata } from "workflow"

import { materializeDataset } from "../../dataset.ts"
import { getDatasetOutputPath, getDatasetSourcesDir } from "../../datasetFiles.ts"
import { datasetDomain } from "../../domain.ts"
import { actionStep, deterministicReactionEngine } from "../_reactionEngine.ts"

const queryDomain = domain("dataset-workflow-query").schema({
  entities: {
    query_items: i.entity({
      sku: i.string(),
      qty: i.number(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-workflow-test-app")
  .includes(datasetDomain)
  .includes(queryDomain)
  .schema({ entities: {}, links: {}, rooms: {} })
  .withActions(datasetDomain.actions)

type DatasetWorkflowRuntimeEnv = {
  orgId: string
  dbKey: string
  requireStepDb: boolean
  resourceRows: Array<{ id: string; sku: string; qty: number }>
}

type StoredDataset = Record<string, any> & {
  id: string
  datasetId?: string
  dataFileId?: string
  recordIds?: string[]
}

type StoredFile = {
  id: string
  url: string
  contentDisposition?: string
  contentBase64: string
}

type DatasetWorkflowStore = {
  resourceRows: Array<{ id: string; sku: string; qty: number }>
  datasets: Map<string, StoredDataset>
  files: Map<string, StoredFile>
  entities: Map<string, Map<string, Record<string, any>>>
  nextId: number
}

const storesSymbol = Symbol.for("ekairos.dataset.workflowTestStores")

function stores() {
  const root = globalThis as any
  if (!root[storesSymbol]) {
    root[storesSymbol] = new Map<string, DatasetWorkflowStore>()
  }
  return root[storesSymbol] as Map<string, DatasetWorkflowStore>
}

function getStore(env: DatasetWorkflowRuntimeEnv): DatasetWorkflowStore {
  const existing = stores().get(env.dbKey)
  if (existing) {
    if (existing.resourceRows.length === 0 && env.resourceRows.length > 0) {
      existing.resourceRows = env.resourceRows
    }
    return existing
  }

  const created: DatasetWorkflowStore = {
    resourceRows: env.resourceRows,
    datasets: new Map(),
    files: new Map(),
    entities: new Map(),
    nextId: 1,
  }
  stores().set(env.dbKey, created)
  return created
}

async function assertDbCallIsStep(env: DatasetWorkflowRuntimeEnv) {
  if (!env.requireStepDb) return

  let workflowRunId: string | null = null
  try {
    workflowRunId = getWorkflowMetadata?.()?.workflowRunId ?? null
  } catch {
    return
  }

  if (!workflowRunId) return

  try {
    getStepMetadata()
  } catch {
    throw new Error("dataset_db_outside_step")
  }
}

function nextId(store: DatasetWorkflowStore, prefix: string) {
  const value = `${prefix}_${store.nextId}`
  store.nextId++
  return value
}

function entityTx(entity: string, id: string) {
  function chain(op: string, payload: Record<string, any>) {
    const txs: any[] = [{ entity, id, op, payload }]
    ;(txs as any).link = (linkPayload: Record<string, any>) => {
      txs.push({ entity, id, op: "link", payload: linkPayload })
      return txs
    }
    ;(txs as any).unlink = (unlinkPayload: Record<string, any>) => {
      txs.push({ entity, id, op: "unlink", payload: unlinkPayload })
      return txs
    }
    return txs
  }
  return {
    create(payload: Record<string, any>) {
      return chain("create", payload)
    },
    update(payload: Record<string, any>) {
      return chain("update", payload)
    },
    link(payload: Record<string, any>) {
      return { entity, id, op: "link", payload }
    },
    unlink(payload: Record<string, any>) {
      return { entity, id, op: "unlink", payload }
    },
    delete() {
      return { entity, id, op: "delete" }
    },
  }
}

function txCollection(entity: string) {
  return new Proxy(
    {},
    {
      get(_target, property) {
        return entityTx(entity, String(property))
      },
    },
  )
}

function dataUrl(contentBase64: string) {
  return `data:application/x-ndjson;base64,${contentBase64}`
}

function getEntityRows(store: DatasetWorkflowStore, entity: string) {
  let rows = store.entities.get(entity)
  if (!rows) {
    rows = new Map()
    store.entities.set(entity, rows)
  }
  return rows
}

function whereValueMatches(actual: unknown, linkedId: unknown, expected: unknown) {
  if (
    expected &&
    typeof expected === "object" &&
    "$in" in expected &&
    Array.isArray((expected as { $in?: unknown[] }).$in)
  ) {
    return (expected as { $in: unknown[] }).$in.some(
      candidate => candidate === actual || candidate === linkedId,
    )
  }
  return actual === expected || linkedId === expected
}

function whereMatches(row: Record<string, any>, where: Record<string, any>) {
  for (const [key, expected] of Object.entries(where ?? {})) {
    if (key.includes(".")) {
      const parts = key.split(".")
      let current: any = row
      for (const part of parts) {
        current = current?.[part]
      }
      if (!whereValueMatches(current, current?.id, expected)) return false
      continue
    }
    const actual = row[key]
    if (!whereValueMatches(actual, actual?.id ?? row[`${key}Id`], expected)) {
      return false
    }
  }
  return true
}

function queryGenericEntity(store: DatasetWorkflowStore, entity: string, spec: Record<string, any>) {
  const rows = Array.from(getEntityRows(store, entity).values())
  const where = spec?.$?.where ?? {}
  const limit = Number(spec?.$?.limit ?? rows.length)
  return rows.filter((row) => whereMatches(row, where)).slice(0, limit)
}

function datasetWithLinks(store: DatasetWorkflowStore, dataset: StoredDataset) {
  const file = dataset.dataFileId ? store.files.get(dataset.dataFileId) : null
  const records = (dataset.recordIds ?? [])
    .map((recordId) => getEntityRows(store, "dataset_records").get(recordId))
    .filter(Boolean)
  return {
    ...dataset,
    ...(file ? { dataFile: file } : {}),
    ...(records.length > 0 ? { records } : {}),
  }
}

function createDb(env: DatasetWorkflowRuntimeEnv) {
  const store = getStore(env)
  return {
    tx: new Proxy(
      {},
      {
        get(_target, property) {
          return txCollection(String(property))
        },
      },
    ),
    streams: {
      createWriteStream({ clientId }: { clientId?: string }) {
        const streamId = nextId(store, "stream")
        const stream = new WritableStream<string>({
          write() {},
          close() {},
          abort() {},
        }) as WritableStream<string> & { streamId: () => Promise<string>; clientId?: string }
        stream.streamId = async () => streamId
        stream.clientId = clientId
        return stream
      },
      createReadStream() {
        return {
          async *[Symbol.asyncIterator]() {},
        }
      },
    },
    storage: {
      async uploadFile(path: string, fileBuffer: Buffer, options?: Record<string, any>) {
        await assertDbCallIsStep(env)
        const fileId = nextId(store, "file")
        const contentBase64 = Buffer.from(fileBuffer).toString("base64")
        store.files.set(fileId, {
          id: fileId,
          url: dataUrl(contentBase64),
          contentDisposition: options?.contentDisposition,
          contentBase64,
        })
        return { data: { id: fileId, path } }
      },
    },
    async query(query: Record<string, any>) {
      await assertDbCallIsStep(env)
      if (query.query_items) {
        return { query_items: store.resourceRows.map((row) => ({ ...row })) }
      }

      if (query.dataset_datasets) {
        const where = query.dataset_datasets?.$?.where ?? {}
        const datasetId = where.datasetId
        const rows = Array.from(store.datasets.values())
          .filter((dataset) => !datasetId || dataset.datasetId === datasetId)
          .map((dataset) => datasetWithLinks(store, dataset))
        return { dataset_datasets: rows }
      }

      if (query.$files) {
        const fileId = query.$files?.$?.where?.id
        const rows = fileId && store.files.has(fileId) ? [{ ...store.files.get(fileId) }] : []
        return { $files: rows }
      }

      const result: Record<string, any[]> = {}
      for (const [entity, spec] of Object.entries(query)) {
        if (entity === "$files" || entity === "dataset_datasets" || entity === "query_items") {
          continue
        }
        result[entity] = queryGenericEntity(store, entity, spec as Record<string, any>)
      }
      return result
    },
    async transact(mutations: any[]) {
      await assertDbCallIsStep(env)
      for (const mutation of mutations.flat()) {
        if (!mutation?.entity || !mutation?.id) continue
        if (mutation.entity === "dataset_datasets" && mutation.op === "update") {
          const existing = store.datasets.get(mutation.id) ?? { id: mutation.id }
          store.datasets.set(mutation.id, { ...existing, ...mutation.payload, id: mutation.id })
        }
        if (mutation.entity === "dataset_datasets" && mutation.op === "link") {
          const existing = store.datasets.get(mutation.id) ?? { id: mutation.id }
          if (mutation.payload?.dataFile) {
            store.datasets.set(mutation.id, { ...existing, dataFileId: mutation.payload.dataFile })
          }
          if (Array.isArray(mutation.payload?.records)) {
            const recordIds = [
              ...(existing.recordIds ?? []),
              ...mutation.payload.records.map((recordId: unknown) => String(recordId)),
            ]
            store.datasets.set(mutation.id, { ...existing, recordIds })
          }
        }
        const rows = getEntityRows(store, mutation.entity)
        if (mutation.op === "delete") {
          rows.delete(mutation.id)
          continue
        }
        const existing = rows.get(mutation.id) ?? { id: mutation.id }
        if (mutation.op === "create" || mutation.op === "update") {
          rows.set(mutation.id, { ...existing, ...mutation.payload, id: mutation.id })
        }
        if (mutation.op === "link") {
          const linked = { ...existing, id: mutation.id }
          for (const [key, value] of Object.entries(mutation.payload ?? {})) {
            linked[key] = typeof value === "string" ? { id: value } : value
            linked[`${key}Id`] = value
          }
          rows.set(mutation.id, linked)
        }
        if (mutation.op === "unlink") {
          const unlinked = { ...existing, id: mutation.id }
          for (const key of Object.keys(mutation.payload ?? {})) {
            delete unlinked[key]
            delete unlinked[`${key}Id`]
          }
          rows.set(mutation.id, unlinked)
        }
      }
    },
  }
}

export class DatasetWorkflowTestRuntime extends EkairosRuntime<
  DatasetWorkflowRuntimeEnv,
  typeof appDomain,
  ReturnType<typeof createDb>
> {
  static [WORKFLOW_SERIALIZE](instance: DatasetWorkflowTestRuntime) {
    return { env: instance.env }
  }

  static [WORKFLOW_DESERIALIZE](data: { env: DatasetWorkflowRuntimeEnv }) {
    return new DatasetWorkflowTestRuntime(data.env)
  }

  protected getDomain() {
    return appDomain
  }

  protected resolveDb(env: DatasetWorkflowRuntimeEnv) {
    return createDb(env)
  }
}

export type DatasetBuilderWorkflowInput = {
  runtime: DatasetWorkflowTestRuntime
  datasetId: string
}

export type DatasetBuilderWorkflowResult = {
  datasetId: string
  previewRows: any[]
  readRows: any[]
}

export type DatasetFileBuilderWorkflowInput = {
  runtime: DatasetWorkflowTestRuntime
  datasetId: string
  fileId: string
  sandboxId: string
}

export type DatasetFileBuilderWorkflowResult = {
  datasetId: string
  previewRows: any[]
}

export type DatasetDirectObjectWorkflowResult = {
  datasetId: string
  object: any
  previewRows: any[]
  readRows: any[]
}

function workflowFileDatasetEngine(datasetId: string) {
  return deterministicReactionEngine({
    steps: [
      actionStep("executeCommand", {
        commandDescription: "Parse the workflow CSV file and write dataset rows to output.jsonl.",
        scriptName: "parse_workflow_file",
        pythonCode: [
        "import csv, glob, json",
        "from pathlib import Path",
        "workspace = Path(__file__).resolve().parents[1]",
        "manifest = json.loads((workspace / 'manifest.json').read_text(encoding='utf-8'))",
        `resources_dir = ${JSON.stringify(getDatasetSourcesDir(datasetId))}`,
        "output_path = str(Path(manifest['outputDir']) / 'output.jsonl')",
        "Path(output_path).parent.mkdir(parents=True, exist_ok=True)",
        "resource_path = glob.glob(resources_dir + '/*')[0]",
        "with open(resource_path, 'r', encoding='utf-8') as src, open(output_path, 'w', encoding='utf-8') as out:",
        "  reader = csv.DictReader(src)",
        "  for row in reader:",
        "    out.write(json.dumps({'type': 'row', 'data': {'code': row['code'], 'qty': int(row['qty'])}}) + '\\n')",
          "print('workflow file parsed')",
        ].join("\n"),
      }),
      actionStep("completeDataset", { summary: "workflow file complete" }),
    ],
  })
}

function workflowDirectObjectEngine() {
  return deterministicReactionEngine({
    steps: [actionStep("completeObject", {
      data: {
        status: "passed",
        score: 91,
        justification: "Evidence satisfies the technical criterion.",
      },
      summary: "direct object completed",
    })],
  })
}

function workflowDirectRowsEngine() {
  return deterministicReactionEngine({
    steps: [actionStep("replaceRows", {
      rows: [
        { sku: "A1", eligible: true },
        { sku: "B2", eligible: false },
      ],
      summary: "direct rows completed",
    })],
  })
}

async function ensureWorkflowSandboxStep(params: {
  runtime: DatasetWorkflowTestRuntime
  sandboxId: string
}) {
  "use step"

  const db = await (params.runtime as any).db()
  await db.transact([
    db.tx.sandbox_sandboxes[params.sandboxId].update({
      provider: "local",
      status: "running",
      createdAt: Date.now(),
      params: { workspaceRoot: "/workspace" },
    }),
  ])
}

export async function datasetQueryBuilderWorkflow(
  input: DatasetBuilderWorkflowInput,
): Promise<DatasetBuilderWorkflowResult> {
  "use workflow";

  const result = await materializeDataset(input.runtime)
    .fromQuery(queryDomain, {
      query: {
        query_items: {},
      },
      title: "Workflow Query Items",
      explanation: "Workflow-safe query resource smoke.",
    })
    .schema({
      title: "WorkflowQueryItem",
      description: "One workflow query item.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["id", "sku", "qty"],
        properties: {
          id: { type: "string" },
          sku: { type: "string" },
          qty: { type: "number" },
        },
      },
    })
    .build({ datasetId: input.datasetId })

  const readResult = await result.reader.read({ cursor: 0, limit: 2 })
  return {
    datasetId: result.datasetId,
    previewRows: result.previewRows,
    readRows: readResult.rows,
  }
}

export async function datasetFileBuilderWorkflow(
  input: DatasetFileBuilderWorkflowInput,
): Promise<DatasetFileBuilderWorkflowResult> {
  "use workflow";
  await ensureWorkflowSandboxStep({ runtime: input.runtime, sandboxId: input.sandboxId })
  const result = await materializeDataset(input.runtime, {
    datasetId: input.datasetId,
  })
    .sandbox(input.sandboxId)
    .fromFile({ fileId: input.fileId })
    .engine(workflowFileDatasetEngine(input.datasetId))
    .schema({
      title: "WorkflowFileRow",
      description: "One row from a workflow file resource.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["code", "qty"],
        properties: {
          code: { type: "string" },
          qty: { type: "number" },
        },
      },
    })
    .build()

  return {
    datasetId: result.datasetId,
    previewRows: result.previewRows,
  }
}

export async function datasetDirectObjectWorkflow(
  input: DatasetBuilderWorkflowInput,
): Promise<DatasetDirectObjectWorkflowResult> {
  "use workflow";

  const sandboxId = `${input.datasetId}-sandbox`
  await ensureWorkflowSandboxStep({ runtime: input.runtime, sandboxId })

  const result = await materializeDataset(input.runtime, {
    datasetId: input.datasetId,
  })
    .sandbox(sandboxId)
    .from({
      kind: "text",
      name: "criterion.json",
      mimeType: "application/json",
      text: JSON.stringify({ title: "Safety" }),
    })
    .from({
      kind: "text",
      name: "evidence.json",
      mimeType: "application/json",
      text: JSON.stringify([{ refId: "email:1", excerpt: "Safety plan attached." }]),
    })
    .instructions("Evaluate one award against one technical criterion.")
    .schema({
      title: "WorkflowDirectObject",
      description: "One direct object dataset row.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["status", "score", "justification"],
        properties: {
          status: { type: "string", enum: ["passed", "failed", "needs_review"] },
          score: { type: "number", minimum: 0, maximum: 100 },
          justification: { type: "string" },
        },
      },
    })
    .engine(workflowDirectObjectEngine())
    .asObject()
    .build()

  const readResult = await result.reader.read({ cursor: 0, limit: 2 })
  return {
    datasetId: result.datasetId,
    object: result.object,
    previewRows: result.previewRows,
    readRows: readResult.rows,
  }
}

export async function datasetDirectRowsWorkflow(
  input: DatasetBuilderWorkflowInput,
): Promise<DatasetBuilderWorkflowResult> {
  "use workflow";

  const sandboxId = `${input.datasetId}-sandbox`
  await ensureWorkflowSandboxStep({ runtime: input.runtime, sandboxId })

  const result = await materializeDataset(input.runtime, {
    datasetId: input.datasetId,
  })
    .sandbox(sandboxId)
    .from({
      kind: "text",
      name: "items.json",
      mimeType: "application/json",
      text: JSON.stringify([{ sku: "A1" }, { sku: "B2" }]),
    })
    .from({
      kind: "text",
      name: "rules.json",
      mimeType: "application/json",
      text: JSON.stringify({ rule: "A1 eligible only" }),
    })
    .instructions("Classify item eligibility.")
    .schema({
      title: "WorkflowDirectRows",
      description: "Direct row output.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["sku", "eligible"],
        properties: {
          sku: { type: "string" },
          eligible: { type: "boolean" },
        },
      },
    })
    .engine(workflowDirectRowsEngine())
    .build()

  const readResult = await result.reader.read({ cursor: 0, limit: 10 })
  return {
    datasetId: result.datasetId,
    previewRows: result.previewRows,
    readRows: readResult.rows,
  }
}

export async function datasetDirectRowsAsResourceWorkflow(
  input: DatasetBuilderWorkflowInput,
): Promise<DatasetBuilderWorkflowResult & { sourceDatasetId: string }> {
  "use workflow";

  const sourceDatasetId = `${input.datasetId}_source`
  const sourceSandboxId = `${sourceDatasetId}-sandbox`
  const targetSandboxId = `${input.datasetId}-sandbox`
  await ensureWorkflowSandboxStep({ runtime: input.runtime, sandboxId: sourceSandboxId })
  await ensureWorkflowSandboxStep({ runtime: input.runtime, sandboxId: targetSandboxId })
  await materializeDataset(input.runtime, {
    datasetId: sourceDatasetId,
  })
    .sandbox(sourceSandboxId)
    .from({
      kind: "text",
      name: "items.json",
      mimeType: "application/json",
      text: JSON.stringify([{ sku: "A1" }, { sku: "B2" }]),
    })
    .from({
      kind: "text",
      name: "rules.json",
      mimeType: "application/json",
      text: JSON.stringify({ rule: "A1 eligible only" }),
    })
    .instructions("Create direct source rows.")
    .schema({
      title: "WorkflowDirectSourceRows",
      description: "Direct source rows.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["sku", "eligible"],
        properties: {
          sku: { type: "string" },
          eligible: { type: "boolean" },
        },
      },
    })
    .engine(workflowDirectRowsEngine())
    .build()

  const result = await materializeDataset(input.runtime, {
    datasetId: input.datasetId,
  })
    .sandbox(targetSandboxId)
    .fromDataset({ datasetId: sourceDatasetId, description: "direct source rows" })
    .instructions("Copy direct source rows.")
    .schema({
      title: "WorkflowDirectRowsCopy",
      description: "Copied direct rows.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["sku", "eligible"],
        properties: {
          sku: { type: "string" },
          eligible: { type: "boolean" },
        },
      },
    })
    .engine(workflowDirectRowsEngine())
    .build()

  const readResult = await result.reader.read({ cursor: 0, limit: 10 })
  return {
    sourceDatasetId,
    datasetId: result.datasetId,
    previewRows: result.previewRows,
    readRows: readResult.rows,
  }
}

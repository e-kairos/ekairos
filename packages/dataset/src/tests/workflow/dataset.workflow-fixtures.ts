import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"
import type { ContextReactor } from "@ekairos/events"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { getStepMetadata, getWorkflowMetadata } from "workflow"

import { dataset } from "../../index.ts"
import { resolveDatasetAgentDurable } from "../../builder/materialize.ts"
import { getDatasetOutputPath, getDatasetResourcesDir } from "../../datasetFiles.ts"
import { datasetDomain } from "../../schema.ts"

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

function whereMatches(row: Record<string, any>, where: Record<string, any>) {
  for (const [key, expected] of Object.entries(where ?? {})) {
    if (key.includes(".")) {
      const parts = key.split(".")
      let current: any = row
      for (const part of parts) {
        current = current?.[part]
      }
      if (current !== expected) return false
      continue
    }
    const actual = row[key]
    if (actual !== expected && actual?.id !== expected && row[`${key}Id`] !== expected) {
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
  return file ? { ...dataset, dataFile: file } : { ...dataset }
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

export async function workflowFileDatasetReactor(params: any) {
  const datasetId = String(params.context?.content?.datasetId ?? "")
  const pythonCode = [
    "import csv, glob, json",
    "from pathlib import Path",
    "workspace = Path(__file__).resolve().parents[1]",
    "manifest = json.loads((workspace / 'manifest.json').read_text(encoding='utf-8'))",
    `resources_dir = ${JSON.stringify(getDatasetResourcesDir(datasetId))}`,
    "output_path = str(Path(manifest['outputDir']) / 'output.jsonl')",
    "Path(output_path).parent.mkdir(parents=True, exist_ok=True)",
    "resource_path = glob.glob(resources_dir + '/*')[0]",
    "with open(resource_path, 'r', encoding='utf-8') as src, open(output_path, 'w', encoding='utf-8') as out:",
    "  reader = csv.DictReader(src)",
    "  for row in reader:",
    "    out.write(json.dumps({'type': 'row', 'data': {'code': row['code'], 'qty': int(row['qty'])}}) + '\\n')",
    "print('workflow file parsed')",
  ].join("\n")

  if (params.iteration === 0) {
    return {
      assistantEvent: {
        content: {
          parts: [
            {
              type: "tool-executeCommand",
              toolCallId: "parse-workflow-file",
              input: {
                scriptName: "parse_workflow_file",
                pythonCode,
              },
            },
          ],
        },
      },
      actionRequests: [
        {
          actionRef: "parse-workflow-file",
          actionName: "executeCommand",
          input: {
            scriptName: "parse_workflow_file",
            pythonCode,
          },
        },
      ],
      messagesForModel: [],
    }
  }

  return {
    assistantEvent: {
      content: {
        parts: [
          {
            type: "tool-completeDataset",
            toolCallId: "complete-workflow-file",
            input: { summary: "workflow file complete" },
          },
        ],
      },
    },
    actionRequests: [
      {
        actionRef: "complete-workflow-file",
        actionName: "completeDataset",
        input: { summary: "workflow file complete" },
      },
    ],
    messagesForModel: [],
  }
}

export async function datasetQueryBuilderWorkflow(
  input: DatasetBuilderWorkflowInput,
): Promise<DatasetBuilderWorkflowResult> {
  "use workflow";

  const result = await dataset(input.runtime)
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
  const result = await dataset(input.runtime, {
    datasetId: input.datasetId,
    durable: true,
  })
    .sandbox({ sandboxId: input.sandboxId })
    .fromFile({ fileId: input.fileId })
    .reactor(workflowFileDatasetReactor as ContextReactor<any, any>)
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

export async function datasetAgentDurableResolutionWorkflow(): Promise<boolean> {
  "use workflow";

  return await resolveDatasetAgentDurable(true)
}

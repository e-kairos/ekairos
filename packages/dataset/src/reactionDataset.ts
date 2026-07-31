import type {
  DatasetAdapterFileSource,
  DatasetAdapterProviderInput,
  DatasetAdapterSource,
} from "@ekairos/reactor/internal"

import { materializeDataset } from "./dataset.js"
import { finalizeBuildResult } from "./builder/persistence.js"
import { validateRows } from "./builder/schemaInference.js"
import { normalizeQueryRows, rowsToJsonl } from "./builder/rows.js"
import type {
  AnyDatasetRuntime,
  DatasetBuilder,
  DatasetSourceInput,
} from "./builder/types.js"
import {
  REMOTE_DATASET_MAX_INLINE_ROWS,
  RemoteDatasetStoreError,
  remoteDatasetStore,
  type RemoteDatasetScope,
  type RemoteDatasetStore,
} from "./remoteDatasetStore.js"

export type BuildReactionDatasetOptions = Readonly<{
  store: RemoteDatasetStore
  scope: RemoteDatasetScope
}>

export type RemoteDatasetEnvironment = Readonly<Record<string, string | undefined>>

export function remoteDatasetOptionsFromEnv(
  env: RemoteDatasetEnvironment = process.env,
): BuildReactionDatasetOptions | undefined {
  const endpoint = env.EKAIROS_DATASET_ENDPOINT?.trim() ?? ""
  const token = env.EKAIROS_DATASET_TOKEN?.trim() ?? ""
  const app = env.EKAIROS_DATASET_APP?.trim() ?? ""
  const environment = env.EKAIROS_DATASET_ENV?.trim() ?? ""
  const organizationId = env.EKAIROS_DATASET_ORGANIZATION_ID?.trim() ?? ""
  const required = { endpoint, token, app, env: environment }
  const configured = Object.values(required).filter(Boolean).length
  if (configured === 0) return undefined
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (missing.length > 0) {
    throw new Error(`remote_dataset_env_incomplete:${missing.join(",")}`)
  }
  return {
    store: remoteDatasetStore({
      endpoint,
      token,
      ...(organizationId ? { organizationId } : {}),
    }),
    scope: { app, env: environment },
  }
}

export async function buildReactionDataset(
  input: DatasetAdapterProviderInput,
  options?: BuildReactionDatasetOptions,
) {
  if (options) return await buildRemoteReactionDataset(input, options)
  return await buildInstantReactionDataset(input)
}

async function buildInstantReactionDataset(
  input: DatasetAdapterProviderInput,
  sourceStore?: RemoteDatasetStore,
) {
  const { spec } = input
  const datasetId = spec.datasetId
  const runtime = input.runtime as AnyDatasetRuntime & any

  if ("open" in spec) {
    const opened = await finalizeBuildResult(runtime, datasetId, false)
    assertCompletedDataset(opened.dataset, datasetId)
    return {
      datasetId: opened.datasetId,
      mode: "opened" as const,
      previewRows: opened.previewRows,
      count: datasetRowCount(opened.dataset),
      reader: opened.reader,
    }
  }

  try {
    const opened = await finalizeBuildResult(runtime, datasetId, false)
    assertCompletedDataset(opened.dataset, datasetId)
    return {
      datasetId: opened.datasetId,
      mode: "opened" as const,
      previewRows: opened.previewRows,
      count: datasetRowCount(opened.dataset),
      reader: opened.reader,
    }
  } catch {
    // A missing deterministic id is built exactly once below.
  }

  const ensure = spec.ensure
  const builder = materializeDataset(input.runtime as AnyDatasetRuntime & any, {
    datasetId,
    parentSessionId: input.sessionId,
  })
  if (input.sandboxId) builder.sandbox(input.sandboxId)
  if (input.engine) builder.engine(input.engine)
  if (ensure.title) builder.title(ensure.title)
  await applySource(builder, ensure.source, sourceStore)
  if (ensure.instructions) builder.instructions(ensure.instructions)
  if (ensure.schema) builder.schema(ensure.schema as any)
  else builder.auto()
  if (ensure.output === "object") builder.asObject()
  else builder.asRows()

  const built = await builder.build({ datasetId })
  return {
    datasetId: built.datasetId,
    mode: "built" as const,
    previewRows: built.previewRows,
    count: datasetRowCount(built.dataset),
    reader: built.reader,
  }
}

async function buildRemoteReactionDataset(
  input: DatasetAdapterProviderInput,
  options: BuildReactionDatasetOptions,
) {
  const { spec } = input

  if ("open" in spec) {
    return await openRemoteDataset(options.store, spec.datasetId, "opened")
  }

  try {
    return await openRemoteDataset(options.store, spec.datasetId, "opened")
  } catch (error) {
    if (!(error instanceof RemoteDatasetStoreError) || error.status !== 404) {
      throw error
    }
  }

  const ensure = spec.ensure
  const directRows = await resolveDirectRemoteRows(input, ensure.source, ensure.instructions)
  if (directRows) {
    validateDirectOutput(directRows, ensure.output)
    if (ensure.schema) validateRows(directRows, ensure.schema as any)
    return await materializeRemoteRows(options, {
      rows: directRows,
      name: ensure.title,
    })
  }

  const staged = await buildInstantReactionDataset(input, options.store)
  const finalRows = await readInlineResultRows(staged.reader)
  return await materializeRemoteRows(options, {
    rows: finalRows,
    name: ensure.title,
  })
}

async function resolveDirectRemoteRows(
  input: DatasetAdapterProviderInput,
  source: DatasetAdapterSource,
  instructions?: string,
): Promise<any[] | null> {
  if (String(instructions ?? "").trim()) return null
  if ("rows" in source) return [...source.rows]
  if (!("query" in source)) return null
  if (!source.domain) throw new Error("dataset_query_source_requires_domain")
  const runtime = input.runtime as AnyDatasetRuntime & any
  const db = await runtime.db()
  const result = await db.query(source.query as any)
  return normalizeQueryRows(result)
}

function validateDirectOutput(rows: any[], output?: "rows" | "object") {
  if (output === "object" && rows.length > 1) {
    throw new Error("dataset_first_expected_zero_or_one_row")
  }
}

async function materializeRemoteRows(
  options: BuildReactionDatasetOptions,
  input: { rows: readonly unknown[]; name?: string },
) {
  const materialized = await options.store.materialize({
    ...options.scope,
    ...(input.name ? { name: input.name } : {}),
    source: {
      kind: "rows",
      rows: input.rows,
      origin: "@ekairos/dataset",
    },
  })
  return {
    datasetId: materialized.datasetId,
    mode: "built" as const,
    previewRows: materialized.preview,
    count: materialized.rowCount,
    reader: createRemoteReader(options.store, materialized.datasetId),
  }
}

async function openRemoteDataset(
  store: RemoteDatasetStore,
  datasetId: string,
  mode: "opened" | "built",
) {
  const opened = await store.rows({ datasetId, offset: 0, limit: 20 })
  return {
    datasetId,
    mode,
    previewRows: opened.rows,
    count: opened.rowCount,
    reader: createRemoteReader(store, datasetId),
  }
}

function createRemoteReader(store: RemoteDatasetStore, datasetId: string) {
  return {
    async read(params?: { cursor?: number; limit?: number }) {
      const cursor = params?.cursor ?? 0
      const result = await store.rows({
        datasetId,
        offset: cursor,
        ...(params?.limit === undefined ? {} : { limit: params.limit }),
      })
      const nextCursor = cursor + result.rows.length
      return {
        rows: result.rows,
        cursor: nextCursor,
        done: nextCursor >= result.rowCount,
      }
    },
  }
}

async function readInlineResultRows(
  reader: {
    read(params?: { cursor?: number; limit?: number }): Promise<{
      rows: any[]
      cursor: number
      done: boolean
    }>
  },
): Promise<any[]> {
  const rows: any[] = []
  let cursor = 0
  while (true) {
    const page = await reader.read({
      cursor,
      limit: Math.min(1_000, REMOTE_DATASET_MAX_INLINE_ROWS + 1 - rows.length),
    })
    rows.push(...page.rows)
    if (rows.length > REMOTE_DATASET_MAX_INLINE_ROWS) {
      throw new Error(
        `remote_dataset_inline_rows_limit_exceeded:${rows.length}>${REMOTE_DATASET_MAX_INLINE_ROWS}`,
      )
    }
    if (page.done) return rows
    if (page.cursor <= cursor) {
      throw new Error(`dataset_reader_cursor_did_not_advance:${cursor}`)
    }
    cursor = page.cursor
  }
}

async function applySource(
  builder: DatasetBuilder<AnyDatasetRuntime & any>,
  source: DatasetAdapterSource,
  sourceStore?: RemoteDatasetStore,
) {
  if ("files" in source) {
    builder.from(...source.files.map(fileSourceToDatasetSource))
    return
  }
  if ("datasets" in source) {
    if (!sourceStore) {
      builder.from(...source.datasets.map(datasetSourceToDatasetSource))
      return
    }
    for (const datasetSource of source.datasets) {
      const rows = await readAllRemoteDatasetRows(sourceStore, datasetSource.datasetId)
      builder.fromText({
        text: rowsToJsonl(rows),
        mimeType: "application/x-ndjson",
        name: `${datasetSource.datasetId}.jsonl`,
        description: datasetSource.description,
      })
    }
    return
  }
  if ("rows" in source) {
    builder.fromText({
      text: rowsToJsonl([...source.rows]),
      mimeType: "application/x-ndjson",
      name: source.name ?? "context-rows.jsonl",
      description: source.description,
    })
    return
  }
  if (!source.domain) throw new Error("dataset_query_source_requires_domain")
  builder.fromQuery(source.domain as any, {
    query: source.query as any,
    title: source.title,
    explanation: source.explanation,
  } as any)
}

async function readAllRemoteDatasetRows(
  store: RemoteDatasetStore,
  datasetId: string,
): Promise<any[]> {
  const rows: any[] = []
  let offset = 0
  while (true) {
    const page = await store.rows({
      datasetId,
      offset,
      limit: REMOTE_DATASET_MAX_INLINE_ROWS,
    })
    rows.push(...page.rows)
    const nextOffset = offset + page.rows.length
    if (nextOffset >= page.rowCount) return rows
    if (nextOffset <= offset) {
      throw new Error(`remote_dataset_reader_offset_did_not_advance:${offset}`)
    }
    offset = nextOffset
  }
}

function fileSourceToDatasetSource(source: DatasetAdapterFileSource): DatasetSourceInput {
  return {
    kind: "file",
    fileId: source.fileId,
    description: source.description,
    filename: source.filename,
    mediaType: source.mediaType,
  }
}

function datasetSourceToDatasetSource(
  source: { datasetId: string; description?: string },
): DatasetSourceInput {
  return { kind: "dataset", datasetId: source.datasetId, description: source.description }
}

function datasetRowCount(value: any): number | undefined {
  const count = value?.actualGeneratedRowCount ?? value?.calculatedTotalRows
  return typeof count === "number" ? count : undefined
}

function assertCompletedDataset(value: any, datasetId: string) {
  if (value?.status !== "completed") {
    throw new Error(`dataset_not_completed:${datasetId}:${String(value?.status ?? "unknown")}`)
  }
}

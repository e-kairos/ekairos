import { DatasetService } from "../service.js"
import { datasetSchemaDomain } from "../schema.js"
import {
  annotateNotationEvidence,
  inferQueryNotation,
  type DatasetNotation,
} from "../notation.js"
import {
  datasetGetByIdStep,
  datasetPreviewRowsStep,
  datasetReadOneStep,
  datasetReadRowsStep,
} from "../dataset/steps.js"
import { inferDatasetSchema, validateRows } from "./schemaInference.js"
import { rowsToJsonl } from "./rows.js"
import type {
  AnyDatasetRuntime,
  DatasetBuildResult,
  DatasetReader,
  DatasetTextSourceInput,
  MaterializeRowsParams,
} from "./types.js"

export function defaultTextSourceName(source: DatasetTextSourceInput): string {
  if (source.name?.trim()) return source.name.trim()
  const mimeType = String(source.mimeType ?? "").toLowerCase()
  if (mimeType.includes("csv")) return "source.csv"
  if (mimeType.includes("json")) return "source.json"
  if (mimeType.includes("yaml") || mimeType.includes("yml")) return "source.yaml"
  return "source.txt"
}

export async function getDatasetDb<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
) {
  const scoped = await (runtime as any).use(datasetSchemaDomain)
  return scoped.db as any
}

export async function createOrUpdateDatasetMetadata<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
  params: {
    datasetId: string
    sandboxId?: string
    title?: string
    instructions?: string
    contextId: string
    analysis?: any
    schema?: any
    status?: string
  },
) {
  "use step"
  if (!params.contextId.trim()) {
    throw new Error("dataset_context_required")
  }
  const db = await getDatasetDb(runtime)
  const service = new DatasetService(db)
  const result = await service.createDataset({
    id: params.datasetId,
    sandboxId: params.sandboxId,
    title: params.title ?? params.datasetId,
    instructions: params.instructions ?? "",
    contextId: params.contextId,
    analysis: params.analysis,
    schema: params.schema,
    status: params.status ?? "building",
    organizationId: runtime.env.orgId,
  })
  if (!result.ok) {
    throw new Error(result.error)
  }
}

export async function materializeRowsToDataset<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
  params: MaterializeRowsParams,
): Promise<string> {
  "use step"

  if (params.first && params.rows.length > 1) {
    throw new Error("dataset_first_expected_zero_or_one_row")
  }

  const resolvedSchema =
    params.schema ??
    inferDatasetSchema(
      params.rows,
      params.title ? `${params.title}Row` : "DatasetRow",
      params.title ? `One row for ${params.title}` : "One dataset row",
    )

  validateRows(params.rows, resolvedSchema)

  await createOrUpdateDatasetMetadata(runtime, {
    datasetId: params.datasetId,
    sandboxId: params.sandboxId,
    title: params.title,
    instructions: params.instructions,
    contextId: params.contextId,
    analysis: params.analysis,
    schema: resolvedSchema,
    status: "building",
  })

  const db = await getDatasetDb(runtime)
  const service = new DatasetService(db)
  const uploadResult = await service.uploadDatasetOutputFile({
    datasetId: params.datasetId,
    fileBuffer: Buffer.from(rowsToJsonl(params.rows), "utf-8"),
  })
  if (!uploadResult.ok) {
    throw new Error(uploadResult.error)
  }

  const statusResult = await service.updateDatasetStatus({
    datasetId: params.datasetId,
    status: "completed",
    calculatedTotalRows: params.rows.length,
    actualGeneratedRowCount: params.rows.length,
  })
  if (!statusResult.ok) {
    throw new Error(statusResult.error)
  }

  // Formal notation, informative only (never blocks the build): a notation
  // proposed during the build (agent iterations) gets advisory evidence
  // against the materialized rows; query-backed builds with no proposed
  // notation get the deterministic one derived from query + schema + rows.
  try {
    const existing = await service.getDatasetById(params.datasetId)
    const previous = (existing.ok ? existing.data?.notation : null) as DatasetNotation | null
    const analysis = (params.analysis ?? {}) as Record<string, any>
    const queryNotation =
      analysis.query && typeof analysis.query === "object"
        ? inferQueryNotation({
            entityNames: Object.keys(analysis.query),
            rowCount: params.rows.length,
            schema: resolvedSchema,
            explanation:
              typeof analysis.explanation === "string" ? analysis.explanation : undefined,
          })
        : null
    // Query-backed builds are deterministic, so a freshly inferred notation
    // always wins (a prior run's notation would be stale). Only agent-built
    // datasets (no query) keep the notation the agent proposed during the
    // build, which by now is the latest `previous`.
    const candidate =
      queryNotation ??
      (previous && Array.isArray(previous.predicates) && previous.predicates.length > 0
        ? previous
        : null)
    if (candidate) {
      await service.updateDatasetNotation({
        datasetId: params.datasetId,
        notation: annotateNotationEvidence(candidate, params.rows),
      })
    }
  } catch {
    // notation must never affect the build result
  }

  return params.datasetId
}

export async function uploadInlineTextSource<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
  datasetId: string,
  source: DatasetTextSourceInput,
) {
  "use step"

  const db = await getDatasetDb(runtime)
  const fileName = defaultTextSourceName(source)
  const storagePath = `/dataset/source/${datasetId}/${Date.now()}-${fileName}`
  const uploadResult = await db.storage.uploadFile(storagePath, Buffer.from(source.text, "utf-8"), {
    contentType: source.mimeType ?? "text/plain",
    contentDisposition: fileName,
  })
  const fileId = uploadResult?.data?.id
  if (!fileId) {
    throw new Error("dataset_text_source_upload_failed")
  }
  return fileId as string
}

export async function finalizeBuildResult<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
  datasetId: string,
  withFirst: boolean,
): Promise<DatasetBuildResult> {
  const datasetResult = await datasetGetByIdStep({ runtime, datasetId })
  if (!datasetResult.ok) throw new Error(datasetResult.error)
  const previewResult = await datasetPreviewRowsStep({ runtime, datasetId, limit: 20 })

  const reader: DatasetReader = {
    async read(cursorOrParams?: number | { cursor?: number; limit?: number }, limit?: number) {
      const params =
        typeof cursorOrParams === "object" && cursorOrParams !== null
          ? cursorOrParams
          : { cursor: cursorOrParams as number | undefined, limit }
      return await datasetReadRowsStep({
        runtime,
        datasetId,
        cursor: params.cursor,
        limit: params.limit,
      })
    },
  }

  const notation = (datasetResult.data?.notation ?? null) as DatasetNotation | null

  if (!withFirst) {
    return {
      datasetId,
      dataset: datasetResult.data,
      notation,
      previewRows: previewResult.rows,
      reader,
    }
  }

  const firstResult = await datasetReadOneStep({ runtime, datasetId })

  return {
    datasetId,
    dataset: datasetResult.data,
    notation,
    previewRows: previewResult.rows,
    reader,
    firstRow: firstResult.row,
  }
}

export function createDatasetBuildResult<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
  params: {
    datasetId: string
    dataset: any
    previewRows: any[]
    firstRow?: any | null
  },
): DatasetBuildResult {
  const reader: DatasetReader = {
    async read(cursorOrParams?: number | { cursor?: number; limit?: number }, limit?: number) {
      const readParams =
        typeof cursorOrParams === "object" && cursorOrParams !== null
          ? cursorOrParams
          : { cursor: cursorOrParams as number | undefined, limit }
      return await datasetReadRowsStep({
        runtime,
        datasetId: params.datasetId,
        cursor: readParams.cursor,
        limit: readParams.limit,
      })
    },
  }

  return {
    datasetId: params.datasetId,
    dataset: params.dataset,
    notation: (params.dataset?.notation ?? null) as DatasetNotation | null,
    previewRows: params.previewRows,
    reader,
    ...(params.firstRow !== undefined ? { firstRow: params.firstRow } : {}),
  }
}

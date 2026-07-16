import type {
  DatasetAdapterFileSource,
  DatasetAdapterProviderInput,
  DatasetAdapterSource,
} from "@ekairos/reactor/internal"

import { materializeDataset } from "./dataset.js"
import { finalizeBuildResult } from "./builder/persistence.js"
import { rowsToJsonl } from "./builder/rows.js"
import type {
  AnyDatasetRuntime,
  DatasetBuilder,
  DatasetSourceInput,
} from "./builder/types.js"

export async function buildReactionDataset(input: DatasetAdapterProviderInput) {
  const { spec } = input
  const datasetId = spec.datasetId
  const runtime = input.runtime as AnyDatasetRuntime & any

  try {
    const opened = await finalizeBuildResult(runtime, datasetId, false)
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
  applySource(builder, ensure.source)
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

function applySource(
  builder: DatasetBuilder<AnyDatasetRuntime & any>,
  source: DatasetAdapterSource,
) {
  if ("files" in source) {
    builder.from(...source.files.map(fileSourceToDatasetSource))
    return
  }
  if ("datasets" in source) {
    builder.from(...source.datasets.map(datasetSourceToDatasetSource))
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

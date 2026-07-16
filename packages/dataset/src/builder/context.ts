import {
  createContextHandle,
  type ContextRuntimeServiceHandle,
} from "@ekairos/events"

import { datasetDomain } from "../schema.js"
import { DatasetService } from "../service.js"
import { getDomainDescriptor } from "./rows.js"
import type {
  AnyDatasetRuntime,
  DatasetSourceDescriptor,
  InternalDatasetSource,
} from "./types.js"

type DatasetSourceContextContent = {
  datasetId: string
  sources: DatasetSourceDescriptor[]
}

type DatasetSourceContextResolution = {
  contextId: string
  sources: InternalDatasetSource[]
  sourceDescriptors: DatasetSourceDescriptor[]
}

async function getDatasetDb(runtime: AnyDatasetRuntime) {
  const scoped = await (runtime as any).use(datasetDomain)
  return scoped.db as any
}

function sourceKey(index: number, source: InternalDatasetSource): string {
  if (source.kind === "file") return `file:${index}:${source.fileId}`
  if (source.kind === "text") return `text:${index}:${source.name ?? "inline"}`
  if (source.kind === "dataset") return `dataset:${index}:${source.datasetId}`
  return `query:${index}:${source.title ?? "query"}`
}

function sourceName(index: number, source: InternalDatasetSource): string {
  if (source.kind === "file") return source.filename ?? `File ${index + 1}`
  if (source.kind === "text") return source.name ?? `Text ${index + 1}`
  if (source.kind === "dataset") return source.datasetId
  return source.title ?? `Query ${index + 1}`
}

function sourceDescription(source: InternalDatasetSource): string {
  if ("description" in source && typeof source.description === "string" && source.description.trim()) {
    return source.description.trim()
  }
  if (source.kind === "query" && typeof source.explanation === "string" && source.explanation.trim()) {
    return source.explanation.trim()
  }
  return `Explicit ${source.kind} source for dataset materialization.`
}

function describeSource(
  index: number,
  source: InternalDatasetSource,
): DatasetSourceDescriptor {
  const base = {
    key: sourceKey(index, source),
    kind: source.kind,
    name: sourceName(index, source),
    description: sourceDescription(source),
  }

  if (source.kind === "file") {
    return {
      ...base,
      fileId: source.fileId,
      filename: source.filename,
      mediaType: source.mediaType,
    }
  }
  if (source.kind === "text") {
    return {
      ...base,
      text: source.text,
      mimeType: source.mimeType,
    }
  }
  if (source.kind === "dataset") {
    return { ...base, datasetId: source.datasetId }
  }
  return {
    ...base,
    query: source.query,
    title: source.title,
    explanation: source.explanation,
    ...getDomainDescriptor(source.domain),
  }
}

async function enrichDatasetSources(
  runtime: AnyDatasetRuntime,
  sources: DatasetSourceDescriptor[],
): Promise<DatasetSourceDescriptor[]> {
  if (!sources.some(source => source.kind === "dataset")) return sources

  const service = new DatasetService(await getDatasetDb(runtime))
  const enriched: DatasetSourceDescriptor[] = []
  for (const source of sources) {
    if (source.kind !== "dataset" || typeof source.datasetId !== "string") {
      enriched.push(source)
      continue
    }
    const preview = await service.previewRows(source.datasetId, 20)
    enriched.push(preview.ok
      ? { ...source, previewRows: preview.data, previewLimit: 20 }
      : { ...source, previewError: preview.error })
  }
  return enriched
}

async function persistDatasetSourceContextStep(params: {
  runtime: AnyDatasetRuntime
  datasetId: string
  sources: DatasetSourceDescriptor[]
}): Promise<{ contextId: string; sources: DatasetSourceDescriptor[] }> {
  "use step"

  const sources = await enrichDatasetSources(params.runtime, params.sources)
  const context = await createContextHandle<DatasetSourceContextContent>(
    params.runtime as unknown as ContextRuntimeServiceHandle,
    {
      key: `dataset:${params.datasetId}`,
      name: `Dataset ${params.datasetId}`,
      content: { datasetId: params.datasetId, sources },
    },
  )
  return { contextId: context.id, sources }
}

export async function resolveDatasetSourceContext<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
  datasetId: string,
  sources: InternalDatasetSource[],
): Promise<DatasetSourceContextResolution> {
  const descriptors = sources.map((source, index) => describeSource(index, source))
  const persisted = await persistDatasetSourceContextStep({
    runtime,
    datasetId,
    sources: descriptors,
  })
  return {
    contextId: persisted.contextId,
    sources,
    sourceDescriptors: persisted.sources,
  }
}

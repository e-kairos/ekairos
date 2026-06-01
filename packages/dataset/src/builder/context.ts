import { eventsDomain } from "@ekairos/events"

import { createDatasetId } from "../id.js"
import { getDomainDescriptor } from "./rows.js"
import type {
  AnyDatasetRuntime,
  DatasetContextResource as DatasetContextResourceRef,
  DatasetExistingResource,
  DatasetFileResource,
  DatasetTextResource,
  InternalDatasetResource,
} from "./types.js"

type DatasetContextResolution = {
  contextId: string
  resources: InternalDatasetResource[]
}

type DatasetContextResourceRecord = {
  key: string
  type: string
  name: string
  description: string
  [key: string]: unknown
}

function getContextWhere(context: DatasetContextResourceRef) {
  return "id" in context ? { id: context.id as any } : { key: context.key as any }
}

async function getEventsDb(runtime: AnyDatasetRuntime) {
  const scoped = await (runtime as any).use(eventsDomain)
  return scoped.db as any
}

function resourceKey(index: number, resource: InternalDatasetResource): string {
  if (resource.kind === "file") return `file:${index}:${resource.fileId}`
  if (resource.kind === "text") return `text:${index}:${resource.name ?? "inline"}`
  if (resource.kind === "dataset") return `dataset:${index}:${resource.datasetId}`
  if (resource.kind === "query") return `query:${index}:${resource.title ?? "query"}`
  return `resource:${index}`
}

function resourceName(index: number, resource: InternalDatasetResource): string {
  if (resource.kind === "file") return resource.filename ?? `File ${index + 1}`
  if (resource.kind === "text") return resource.name ?? `Text ${index + 1}`
  if (resource.kind === "dataset") return resource.datasetId
  if (resource.kind === "query") return resource.title ?? `Query ${index + 1}`
  return `Resource ${index + 1}`
}

function resourceDescription(resource: InternalDatasetResource): string {
  if ("description" in resource && typeof resource.description === "string" && resource.description.trim()) {
    return resource.description.trim()
  }
  if (resource.kind === "query" && typeof resource.explanation === "string" && resource.explanation.trim()) {
    return resource.explanation.trim()
  }
  return `Dataset ${resource.kind} resource.`
}

function resourceToContextResource(index: number, resource: InternalDatasetResource): DatasetContextResourceRecord {
  const base = {
    key: resourceKey(index, resource),
    type: resource.kind,
    name: resourceName(index, resource),
    description: resourceDescription(resource),
  }

  if (resource.kind === "file") {
    return {
      ...base,
      fileId: resource.fileId,
      filename: resource.filename,
      mediaType: resource.mediaType,
    }
  }

  if (resource.kind === "text") {
    return {
      ...base,
      text: resource.text,
      mimeType: resource.mimeType,
    } as DatasetContextResourceRecord
  }

  if (resource.kind === "dataset") {
    return {
      ...base,
      datasetId: resource.datasetId,
    }
  }

  if (resource.kind === "query") {
    return {
      ...base,
      query: resource.query,
      title: resource.title,
      explanation: resource.explanation,
      ...getDomainDescriptor(resource.domain),
    } as DatasetContextResourceRecord
  }

  return base as DatasetContextResourceRecord
}

async function createDatasetResourceContextStep(params: {
  runtime: AnyDatasetRuntime
  datasetId: string
  resources: DatasetContextResourceRecord[]
}): Promise<{ contextId: string }> {
  "use step"

  const db = await getEventsDb(params.runtime)
  const contextId = createDatasetId()
  const now = new Date()

  await db.transact([
    db.tx.event_contexts[contextId].create({
      createdAt: now,
      updatedAt: now,
      name: `Dataset ${params.datasetId} resource context`,
      status: "open_idle",
      content: {
        datasetId: params.datasetId,
        resourceCount: params.resources.length,
      },
      resources: params.resources,
      description: `Dataset materialization context for ${params.datasetId}.`,
      goal: "Materialize the dataset from the resources declared in this context.",
    }),
  ])

  return {
    contextId,
  }
}

function contextResourceToDatasetResource(resource: DatasetContextResourceRecord): InternalDatasetResource {
  if (resource.type === "file" && typeof resource.fileId === "string" && resource.fileId.trim()) {
    return {
      kind: "file",
      fileId: resource.fileId.trim(),
      description: resource.description,
      filename: typeof resource.filename === "string" ? resource.filename : undefined,
      mediaType: typeof resource.mediaType === "string" ? resource.mediaType : undefined,
    } satisfies DatasetFileResource
  }

  if (
    resource.type === "dataset" &&
    typeof resource.datasetId === "string" &&
    resource.datasetId.trim()
  ) {
    return {
      kind: "dataset",
      datasetId: resource.datasetId.trim(),
      description: resource.description,
    } satisfies DatasetExistingResource
  }

  if (resource.type === "text" && typeof (resource as any).text === "string") {
    return {
      kind: "text",
      text: String((resource as any).text),
      mimeType:
        typeof (resource as any).mimeType === "string"
          ? String((resource as any).mimeType)
          : "text/plain",
      name: resource.name,
      description: resource.description,
    } satisfies DatasetTextResource
  }

  if (resource.type === "query") {
    throw new Error("dataset_context_query_resource_requires_builder_shortcut")
  }

  return {
    kind: "text",
    text: JSON.stringify({ resource }, null, 2),
    mimeType: "application/vnd.ekairos.context-resource+json",
    name: `${resource.key}.context-resource.json`,
    description: resource.description,
  } satisfies DatasetTextResource
}

async function readExistingContext(params: {
  runtime: AnyDatasetRuntime
  context: DatasetContextResourceRef
}): Promise<DatasetContextResolution> {
  "use step"

  const db = await getEventsDb(params.runtime)
  const res = await db.query({
    event_contexts: {
      $: {
        where: getContextWhere(params.context),
        limit: 1,
      },
    },
  })
  const row = (res?.event_contexts as any[])?.[0]
  if (!row?.id) throw new Error("dataset_context_not_found")

  const resources = Array.isArray(row.resources)
    ? (row.resources as DatasetContextResourceRecord[])
    : []
  if (resources.length === 0) {
    throw new Error("dataset_context_resources_required")
  }

  return {
    contextId: String(row.id),
    resources: resources.map((resource) => contextResourceToDatasetResource(resource)),
  }
}

export async function resolveDatasetResourceContext<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime,
  datasetId: string,
  resources: InternalDatasetResource[],
): Promise<DatasetContextResolution> {
  const contextRefs = resources.filter(
    (resource): resource is DatasetContextResourceRef => resource.kind === "context",
  )

  if (contextRefs.length > 1) {
    throw new Error("dataset_context_resource_must_be_unique")
  }

  if (contextRefs.length === 1) {
    if (resources.length > 1) {
      throw new Error("dataset_context_resource_is_exclusive")
    }
    return await readExistingContext({ runtime, context: contextRefs[0] })
  }

  const contextResourceRecords = resources.map((resource, index) =>
    resourceToContextResource(index, resource),
  )
  const created = await createDatasetResourceContextStep({
    runtime,
    datasetId,
    resources: contextResourceRecords,
  })

  return {
    contextId: created.contextId,
    resources,
  }
}

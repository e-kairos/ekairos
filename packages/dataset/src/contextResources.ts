import type { StoredContextResource } from "@ekairos/events"

import { datasetReadOutputJsonlStep } from "./dataset/steps.js"
import { readInstantFileStep } from "./file/steps.js"
import {
  getContextResourcesDir,
  sanitizeContextWorkspacePathSegment,
} from "./contextWorkspace.js"
import {
  runDatasetSandboxCommandStep,
  writeDatasetSandboxFilesStep,
  writeDatasetSandboxTextFilesStep,
} from "./sandbox/steps.js"

type MaterializedContextResource = {
  key: string
  type: string
  name: string
  description: string
  dir: string
  metadataPath: string
  files: Array<{
    path: string
    role: string
    mediaType?: string
  }>
  status: "materialized" | "metadata_only" | "skipped"
  reason?: string
}

export type ContextResourcesMaterialization = {
  contextId: string
  sandboxId: string
  resourcesDir: string
  manifestPath: string
  resources: MaterializedContextResource[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function contentFileName(resource: StoredContextResource): string {
  const filename = asString((resource as any).filename)
  if (filename) {
    return sanitizeContextWorkspacePathSegment(filename, "resource")
  }
  if (resource.type === "dataset") return "resource.jsonl"
  if (resource.type === "text") return "resource.txt"
  return "resource"
}

function selectResources(
  resources: StoredContextResource[],
  resourceKeys?: string[] | null,
) {
  const requested = new Set(
    Array.isArray(resourceKeys)
      ? resourceKeys.map((key) => String(key).trim()).filter(Boolean)
      : [],
  )
  if (requested.size === 0) return resources
  return resources.filter((resource) => requested.has(resource.key))
}

export async function materializeContextResourcesStep(params: {
  runtime: any
  sandboxId: string
  contextId: string
  resources: StoredContextResource[]
  resourceKeys?: string[] | null
}): Promise<ContextResourcesMaterialization> {
  "use step"

  const resourcesDir = getContextResourcesDir({ contextId: params.contextId })
  const manifestPath = `${resourcesDir}/manifest.json`
  const selectedResources = selectResources(params.resources, params.resourceKeys)
  const resourceDirs = selectedResources.map((resource, index) => {
    const segment = sanitizeContextWorkspacePathSegment(
      resource.key,
      `resource_${index + 1}`,
    )
    return `${resourcesDir}/${segment}`
  })

  await runDatasetSandboxCommandStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    cmd: "mkdir",
    args: ["-p", resourcesDir, ...resourceDirs],
  })

  const materialized: MaterializedContextResource[] = []

  for (let index = 0; index < selectedResources.length; index++) {
    const resource = selectedResources[index]
    const resourceDir = resourceDirs[index]
    const metadataPath = `${resourceDir}/metadata.json`
    const files: MaterializedContextResource["files"] = []
    let status: MaterializedContextResource["status"] = "metadata_only"
    let reason: string | undefined

    if (resource.type === "file" && asString((resource as any).fileId)) {
      const file = await readInstantFileStep({
        runtime: params.runtime,
        fileId: asString((resource as any).fileId),
      })
      const path = `${resourceDir}/${contentFileName(resource)}`
      await writeDatasetSandboxFilesStep({
        runtime: params.runtime,
        sandboxId: params.sandboxId,
        files: [{ path, contentBase64: file.contentBase64 }],
      })
      files.push({ path, role: "content", mediaType: asString((resource as any).mediaType) || undefined })
      status = "materialized"
    } else if (resource.type === "dataset" && asString((resource as any).datasetId)) {
      const datasetId = asString((resource as any).datasetId)
      const content = await datasetReadOutputJsonlStep({
        runtime: params.runtime,
        datasetId,
      })
      const path = `${resourceDir}/resource.jsonl`
      await writeDatasetSandboxFilesStep({
        runtime: params.runtime,
        sandboxId: params.sandboxId,
        files: [{ path, contentBase64: content.contentBase64 }],
      })
      files.push({ path, role: "content", mediaType: "application/x-ndjson" })
      status = "materialized"
    } else if (resource.type === "text" && typeof (resource as any).text === "string") {
      const path = `${resourceDir}/${contentFileName(resource)}`
      await writeDatasetSandboxTextFilesStep({
        runtime: params.runtime,
        sandboxId: params.sandboxId,
        files: [{ path, content: String((resource as any).text) }],
      })
      files.push({
        path,
        role: "content",
        mediaType: asString((resource as any).mimeType) || "text/plain",
      })
      status = "materialized"
    } else {
      reason =
        resource.type === "file"
          ? "file resource has no fileId"
          : resource.type === "dataset"
            ? "dataset resource has no datasetId"
            : resource.type === "link" || resource.type === "repository" || resource.type === "external"
              ? `${resource.type} resources are metadata-only until an approved adapter materializes them`
              : "resource type is metadata-only"
    }

    const metadata = {
      ...(asRecord(resource) ?? {}),
      key: resource.key,
      type: resource.type,
      name: resource.name,
      description: resource.description,
      materialized: {
        status,
        reason,
        dir: resourceDir,
        files,
      },
    }
    await writeDatasetSandboxTextFilesStep({
      runtime: params.runtime,
      sandboxId: params.sandboxId,
      files: [{ path: metadataPath, content: JSON.stringify(metadata, null, 2) }],
    })

    materialized.push({
      key: resource.key,
      type: resource.type,
      name: resource.name,
      description: resource.description,
      dir: resourceDir,
      metadataPath,
      files,
      status,
      reason,
    })
  }

  const manifest: ContextResourcesMaterialization = {
    contextId: params.contextId,
    sandboxId: params.sandboxId,
    resourcesDir,
    manifestPath,
    resources: materialized,
  }

  await writeDatasetSandboxTextFilesStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    files: [{ path: manifestPath, content: JSON.stringify(manifest, null, 2) }],
  })

  return manifest
}

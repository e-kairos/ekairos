import type { DatasetSourceDescriptor } from "./builder/types.js"
import { datasetReadOutputJsonlStep } from "./dataset/steps.js"
import { readInstantFileStep } from "./file/steps.js"
import {
  getContextSourcesDir,
  sanitizeContextWorkspacePathSegment,
} from "./contextWorkspace.js"
import {
  runDatasetSandboxCommandStep,
  writeDatasetSandboxFilesStep,
  writeDatasetSandboxTextFilesStep,
} from "./sandbox/steps.js"

type MaterializedDatasetSource = {
  key: string
  kind: string
  name: string
  description: string
  dir: string
  metadataPath: string
  files: Array<{ path: string; role: string; mediaType?: string }>
  status: "materialized" | "metadata_only"
  reason?: string
}

export type DatasetSourcesMaterialization = {
  contextId: string
  sandboxId: string
  sourcesDir: string
  manifestPath: string
  sources: MaterializedDatasetSource[]
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function contentFileName(source: DatasetSourceDescriptor): string {
  const filename = asString(source.filename)
  if (filename) return sanitizeContextWorkspacePathSegment(filename, "source")
  if (source.kind === "dataset") return "source.jsonl"
  if (source.kind === "text") return "source.txt"
  return "source"
}

function selectSources(
  sources: DatasetSourceDescriptor[],
  sourceKeys?: string[] | null,
) {
  const requested = new Set(
    Array.isArray(sourceKeys)
      ? sourceKeys.map(key => String(key).trim()).filter(Boolean)
      : [],
  )
  return requested.size === 0
    ? sources
    : sources.filter(source => requested.has(source.key))
}

export async function materializeDatasetSourcesStep(params: {
  runtime: any
  sandboxId: string
  contextId: string
  sources: DatasetSourceDescriptor[]
  sourceKeys?: string[] | null
}): Promise<DatasetSourcesMaterialization> {
  "use step"

  const sourcesDir = getContextSourcesDir({ contextId: params.contextId })
  const manifestPath = `${sourcesDir}/manifest.json`
  const selected = selectSources(params.sources, params.sourceKeys)
  const sourceDirs = selected.map((source, index) =>
    `${sourcesDir}/${sanitizeContextWorkspacePathSegment(source.key, `source_${index + 1}`)}`)

  await runDatasetSandboxCommandStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    cmd: "mkdir",
    args: ["-p", sourcesDir, ...sourceDirs],
  })

  const materialized: MaterializedDatasetSource[] = []
  for (let index = 0; index < selected.length; index += 1) {
    const source = selected[index]
    const sourceDir = sourceDirs[index]
    const metadataPath = `${sourceDir}/metadata.json`
    const files: MaterializedDatasetSource["files"] = []
    let status: MaterializedDatasetSource["status"] = "metadata_only"
    let reason: string | undefined

    if (source.kind === "file" && asString(source.fileId)) {
      const file = await readInstantFileStep({
        runtime: params.runtime,
        fileId: asString(source.fileId),
      })
      const path = `${sourceDir}/${contentFileName(source)}`
      await writeDatasetSandboxFilesStep({
        runtime: params.runtime,
        sandboxId: params.sandboxId,
        files: [{ path, contentBase64: file.contentBase64 }],
      })
      files.push({ path, role: "content", mediaType: asString(source.mediaType) || undefined })
      status = "materialized"
    } else if (source.kind === "dataset" && asString(source.datasetId)) {
      const content = await datasetReadOutputJsonlStep({
        runtime: params.runtime,
        datasetId: asString(source.datasetId),
      })
      const path = `${sourceDir}/source.jsonl`
      await writeDatasetSandboxFilesStep({
        runtime: params.runtime,
        sandboxId: params.sandboxId,
        files: [{ path, contentBase64: content.contentBase64 }],
      })
      files.push({ path, role: "content", mediaType: "application/x-ndjson" })
      status = "materialized"
    } else if (source.kind === "text" && typeof source.text === "string") {
      const path = `${sourceDir}/${contentFileName(source)}`
      await writeDatasetSandboxTextFilesStep({
        runtime: params.runtime,
        sandboxId: params.sandboxId,
        files: [{ path, content: source.text }],
      })
      files.push({ path, role: "content", mediaType: asString(source.mimeType) || "text/plain" })
      status = "materialized"
    } else {
      reason = `Source kind ${source.kind} is represented by metadata only.`
    }

    await writeDatasetSandboxTextFilesStep({
      runtime: params.runtime,
      sandboxId: params.sandboxId,
      files: [{
        path: metadataPath,
        content: JSON.stringify({
          ...source,
          materialized: { status, reason, dir: sourceDir, files },
        }, null, 2),
      }],
    })
    materialized.push({
      key: source.key,
      kind: source.kind,
      name: source.name,
      description: source.description,
      dir: sourceDir,
      metadataPath,
      files,
      status,
      reason,
    })
  }

  const manifest: DatasetSourcesMaterialization = {
    contextId: params.contextId,
    sandboxId: params.sandboxId,
    sourcesDir,
    manifestPath,
    sources: materialized,
  }
  await writeDatasetSandboxTextFilesStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    files: [{ path: manifestPath, content: JSON.stringify(manifest, null, 2) }],
  })
  return manifest
}

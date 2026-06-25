import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import {
  asRecord,
  writeContextLocalBinary,
  writeContextLocalJson,
  writeContextLocalText,
} from "./context.local-io.js"
import {
  safeContextLocalFilename,
  safeContextLocalSegment,
  safeContextResourceLocalSegment,
} from "./context.local-paths.js"
import type {
  ContextLocalFileMaterial,
  ContextLocalFileReader,
  ContextLocalRepositoryMaterializer,
  PreparedContextResource,
  PreparedContextResourceFile,
} from "./context.local-types.js"
import type { StoredContextResource } from "./context.store.js"

export type MaterializeContextResourceOptions = {
  resourcesDir: string
  resource: StoredContextResource
  readFile?: ContextLocalFileReader
  materializeRepository?: ContextLocalRepositoryMaterializer
}

function stripInlineContent(resource: StoredContextResource) {
  const record = { ...resource } as Record<string, unknown>
  delete record.content
  delete record.text
  delete record.contentBase64
  delete record.dataBase64
  delete record.base64
  return record
}

function readInlineFile(resource: StoredContextResource): ContextLocalFileMaterial | null {
  const record = asRecord(resource)
  const fileId =
    typeof record.fileId === "string" && record.fileId.trim()
      ? record.fileId
      : typeof record.documentId === "string" && record.documentId.trim()
        ? record.documentId
        : ""
  if (!fileId) return null

  const filename =
    typeof record.filename === "string" && record.filename.trim()
      ? record.filename
      : `${fileId}.bin`
  const mediaType = typeof record.mediaType === "string" ? record.mediaType : undefined

  if (typeof record.contentBase64 === "string") {
    return { fileId, filename, mediaType, contentBase64: record.contentBase64 }
  }

  if (typeof record.dataBase64 === "string") {
    return { fileId, filename, mediaType, contentBase64: record.dataBase64 }
  }

  if (typeof record.content === "string") {
    return { fileId, filename, mediaType, content: record.content }
  }

  return null
}

async function materializeFileResource(params: {
  resource: StoredContextResource
  resourceDir: string
  readFile?: ContextLocalFileReader
}): Promise<Pick<PreparedContextResource, "status" | "reason" | "files">> {
  const inline = readInlineFile(params.resource)
  const file = inline ?? (params.readFile ? await params.readFile(params.resource) : null)

  if (!file?.fileId) {
    return {
      status: "metadata_only",
      reason: "file content is not available to the local materializer",
      files: [],
    }
  }

  const resourceRecord = asRecord(params.resource)
  const filename = safeContextLocalFilename(
    file.filename ??
      (typeof resourceRecord.filename === "string" ? resourceRecord.filename : undefined),
    `${file.fileId}.bin`,
  )
  const fileDir = join(
    params.resourceDir,
    "files",
    safeContextLocalSegment(file.fileId, "file"),
  )
  const filePath = join(fileDir, filename)
  const mediaType =
    file.mediaType ??
    (typeof resourceRecord.mediaType === "string" ? resourceRecord.mediaType : undefined)

  if (file.contentBase64) {
    await writeContextLocalBinary(filePath, Buffer.from(file.contentBase64, "base64"))
  } else if (file.content instanceof Uint8Array) {
    await writeContextLocalBinary(filePath, file.content)
  } else {
    await writeContextLocalText(filePath, String(file.content ?? ""))
  }

  await writeContextLocalJson(join(fileDir, "metadata.json"), {
    fileId: file.fileId,
    filename,
    mediaType,
    sourceResourceKey: params.resource.key,
  })

  return {
    status: "materialized",
    files: [
      {
        fileId: file.fileId,
        filename,
        path: filePath,
        mediaType,
      },
    ],
  }
}

export async function materializeContextResource(
  options: MaterializeContextResourceOptions,
): Promise<PreparedContextResource> {
  const resourceDir = join(options.resourcesDir, safeContextResourceLocalSegment(options.resource))
  await mkdir(resourceDir, { recursive: true })

  let status: PreparedContextResource["status"] = "metadata_only"
  let reason: string | undefined
  let files: PreparedContextResourceFile[] = []
  let repositoryDir: string | undefined

  if (options.resource.type === "file") {
    const materialized = await materializeFileResource({
      resource: options.resource,
      resourceDir,
      readFile: options.readFile,
    })
    status = materialized.status
    reason = materialized.reason
    files = materialized.files
  } else if (options.resource.type === "repository") {
    repositoryDir = join(resourceDir, "repository")
    await mkdir(repositoryDir, { recursive: true })
    if (options.materializeRepository) {
      await options.materializeRepository(options.resource, repositoryDir)
      status = "materialized"
    } else {
      reason = "repository clone materializer was not provided"
    }
  } else {
    const record = asRecord(options.resource)
    if (typeof record.text === "string") {
      await writeContextLocalText(join(resourceDir, "content.txt"), record.text)
      status = "materialized"
    } else if (typeof record.content === "string") {
      await writeContextLocalText(join(resourceDir, "content.txt"), record.content)
      status = "materialized"
    } else if (typeof record.jsonl === "string") {
      await writeContextLocalText(join(resourceDir, "data.jsonl"), record.jsonl)
      status = "materialized"
    } else {
      reason = "resource has no local file payload"
    }
  }

  const metadataPath = join(resourceDir, "metadata.json")
  await writeContextLocalJson(metadataPath, {
    ...stripInlineContent(options.resource),
    local: {
      status,
      reason,
      dir: resourceDir,
      files,
      repositoryDir,
    },
  })

  return {
    key: options.resource.key,
    type: options.resource.type,
    dir: resourceDir,
    metadataPath,
    status,
    reason,
    files,
    repositoryDir,
  }
}

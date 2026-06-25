import { mkdir } from "node:fs/promises"
import path from "node:path"
import { posix } from "node:path"

import {
  asRecord,
} from "./context.local-io.js"
import {
  safeContextLocalFilename,
  safeContextLocalSegment,
  safeContextResourceLocalSegment,
} from "./context.local-paths.js"
import type {
  ContextLocalFileMaterial,
  ContextLocalFileReader,
  PreparedContextLocal,
  PreparedContextResource,
  PreparedContextResourceFile,
  PreparedExecutionLocal,
  PreparedStepPartLocal,
} from "./context.local-types.js"
import type { StoredContext, StoredContextResource } from "./context.store.js"

export type ContextSandboxSession = {
  id: string
  provider: string
  workspaceRoot: string
  writeFile(file: {
    path: string
    content: string | Uint8Array | Buffer
    encoding?: "utf-8" | "base64"
  }): Promise<void>
  writeFiles?(files: Array<{
    path: string
    content: string | Uint8Array | Buffer
    encoding?: "utf-8" | "base64"
  }>): Promise<void>
  exec?(input: { command: string; args?: string[]; cwd?: string }): Promise<unknown>
  stop?(): Promise<void>
}

export type ContextSandboxRepositoryMaterializer = (
  resource: StoredContextResource,
  repositoryDir: string,
  sandbox: ContextSandboxSession,
) => Promise<void> | void

export type PrepareContextSandboxOptions<Context = unknown> = {
  sandbox: ContextSandboxSession
  context: Pick<StoredContext<Context>, "id" | "key" | "content" | "resources">
  readFile?: ContextLocalFileReader
  materializeRepository?: ContextSandboxRepositoryMaterializer
}

export type PrepareExecutionSandboxOptions<Context = unknown> =
  PrepareContextSandboxOptions<Context> & {
    executionId: string
    triggerEventId?: string
    reactionEventId?: string
  }

export type PrepareStepPartSandboxOptions = {
  sandbox: ContextSandboxSession
  contextId: string
  executionId: string
  stepId: string
  partId: string
  metadata?: Record<string, unknown> | null
}

function isPosixRoot(root: string) {
  return root.startsWith("/")
}

function joinSandboxPath(root: string, ...segments: string[]) {
  return isPosixRoot(root)
    ? posix.join(root, ...segments)
    : path.join(root, ...segments)
}

function dirnameSandboxPath(filePath: string) {
  return isPosixRoot(filePath) ? posix.dirname(filePath) : path.dirname(filePath)
}

function contextRoot(params: { basePath: string; contextId: string }) {
  return joinSandboxPath(
    params.basePath,
    "contexts",
    safeContextLocalSegment(params.contextId, "context"),
  )
}

function executionRoot(params: {
  basePath: string
  contextId: string
  executionId: string
}) {
  return joinSandboxPath(
    contextRoot(params),
    "executions",
    safeContextLocalSegment(params.executionId, "execution"),
  )
}

function stepPartRoot(params: {
  basePath: string
  contextId: string
  executionId: string
  stepId: string
  partId: string
}) {
  return joinSandboxPath(
    executionRoot(params),
    "steps",
    safeContextLocalSegment(params.stepId, "step"),
    "parts",
    safeContextLocalSegment(params.partId, "part"),
  )
}

async function ensureSandboxDir(sandbox: ContextSandboxSession, dir: string) {
  if (sandbox.provider === "local") {
    await mkdir(dir, { recursive: true })
    return
  }

  if (sandbox.exec) {
    await sandbox.exec({ command: "mkdir", args: ["-p", dir] })
    return
  }

  await sandbox.writeFile({
    path: joinSandboxPath(dir, ".keep"),
    content: "",
  })
}

async function writeSandboxJson(
  sandbox: ContextSandboxSession,
  filePath: string,
  value: unknown,
) {
  await ensureSandboxDir(sandbox, dirnameSandboxPath(filePath))
  await sandbox.writeFile({
    path: filePath,
    content: `${JSON.stringify(value, null, 2)}\n`,
  })
}

async function writeSandboxText(
  sandbox: ContextSandboxSession,
  filePath: string,
  content: string,
) {
  await ensureSandboxDir(sandbox, dirnameSandboxPath(filePath))
  await sandbox.writeFile({ path: filePath, content })
}

async function writeSandboxBinary(
  sandbox: ContextSandboxSession,
  filePath: string,
  content: Uint8Array,
) {
  await ensureSandboxDir(sandbox, dirnameSandboxPath(filePath))
  await sandbox.writeFile({ path: filePath, content })
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
  sandbox: ContextSandboxSession
  resource: StoredContextResource
  resourceDir: string
  readFile?: ContextLocalFileReader
}): Promise<Pick<PreparedContextResource, "status" | "reason" | "files">> {
  const inline = readInlineFile(params.resource)
  const file = inline ?? (params.readFile ? await params.readFile(params.resource) : null)

  if (!file?.fileId) {
    return {
      status: "metadata_only",
      reason: "file content is not available to the sandbox materializer",
      files: [],
    }
  }

  const resourceRecord = asRecord(params.resource)
  const filename = safeContextLocalFilename(
    file.filename ??
      (typeof resourceRecord.filename === "string" ? resourceRecord.filename : undefined),
    `${file.fileId}.bin`,
  )
  const fileDir = joinSandboxPath(
    params.resourceDir,
    "files",
    safeContextLocalSegment(file.fileId, "file"),
  )
  const filePath = joinSandboxPath(fileDir, filename)
  const mediaType =
    file.mediaType ??
    (typeof resourceRecord.mediaType === "string" ? resourceRecord.mediaType : undefined)

  if (file.contentBase64) {
    await writeSandboxBinary(
      params.sandbox,
      filePath,
      new Uint8Array(Buffer.from(file.contentBase64, "base64")),
    )
  } else if (file.content instanceof Uint8Array) {
    await writeSandboxBinary(params.sandbox, filePath, file.content)
  } else {
    await writeSandboxText(params.sandbox, filePath, String(file.content ?? ""))
  }

  await writeSandboxJson(params.sandbox, joinSandboxPath(fileDir, "metadata.json"), {
    fileId: file.fileId,
    filename,
    mediaType,
    sourceResourceKey: params.resource.key,
  })

  return {
    status: "materialized",
    files: [{ fileId: file.fileId, filename, path: filePath, mediaType }],
  }
}

async function materializeContextResource(params: {
  sandbox: ContextSandboxSession
  resourcesDir: string
  resource: StoredContextResource
  readFile?: ContextLocalFileReader
  materializeRepository?: ContextSandboxRepositoryMaterializer
}): Promise<PreparedContextResource> {
  const resourceDir = joinSandboxPath(
    params.resourcesDir,
    safeContextResourceLocalSegment(params.resource),
  )
  await ensureSandboxDir(params.sandbox, resourceDir)

  let status: PreparedContextResource["status"] = "metadata_only"
  let reason: string | undefined
  let files: PreparedContextResourceFile[] = []
  let repositoryDir: string | undefined

  if (params.resource.type === "file") {
    const materialized = await materializeFileResource({
      sandbox: params.sandbox,
      resource: params.resource,
      resourceDir,
      readFile: params.readFile,
    })
    status = materialized.status
    reason = materialized.reason
    files = materialized.files
  } else if (params.resource.type === "repository") {
    repositoryDir = joinSandboxPath(resourceDir, "repository")
    await ensureSandboxDir(params.sandbox, repositoryDir)
    if (params.materializeRepository) {
      await params.materializeRepository(params.resource, repositoryDir, params.sandbox)
      status = "materialized"
    } else {
      reason = "repository clone materializer was not provided"
    }
  } else {
    const record = asRecord(params.resource)
    if (typeof record.text === "string") {
      await writeSandboxText(params.sandbox, joinSandboxPath(resourceDir, "content.txt"), record.text)
      status = "materialized"
    } else if (typeof record.content === "string") {
      await writeSandboxText(params.sandbox, joinSandboxPath(resourceDir, "content.txt"), record.content)
      status = "materialized"
    } else if (typeof record.jsonl === "string") {
      await writeSandboxText(params.sandbox, joinSandboxPath(resourceDir, "data.jsonl"), record.jsonl)
      status = "materialized"
    } else {
      reason = "resource has no sandbox file payload"
    }
  }

  const metadataPath = joinSandboxPath(resourceDir, "metadata.json")
  await writeSandboxJson(params.sandbox, metadataPath, {
    ...stripInlineContent(params.resource),
    sandbox: {
      status,
      reason,
      dir: resourceDir,
      files,
      repositoryDir,
    },
  })

  return {
    key: params.resource.key,
    type: params.resource.type,
    dir: resourceDir,
    metadataPath,
    status,
    reason,
    files,
    repositoryDir,
  }
}

export async function prepareContextSandbox<Context = unknown>(
  options: PrepareContextSandboxOptions<Context>,
): Promise<PreparedContextLocal> {
  const root = contextRoot({
    basePath: options.sandbox.workspaceRoot,
    contextId: options.context.id,
  })
  const resourcesDir = joinSandboxPath(root, "resources")
  const executionsDir = joinSandboxPath(root, "executions")
  await Promise.all([
    ensureSandboxDir(options.sandbox, resourcesDir),
    ensureSandboxDir(options.sandbox, executionsDir),
  ])

  const resources = []
  for (const resource of options.context.resources ?? []) {
    resources.push(await materializeContextResource({
      sandbox: options.sandbox,
      resourcesDir,
      resource,
      readFile: options.readFile,
      materializeRepository: options.materializeRepository,
    }))
  }

  const manifestPath = joinSandboxPath(root, "manifest.json")
  await writeSandboxJson(options.sandbox, manifestPath, {
    contextId: options.context.id,
    contextKey: options.context.key,
    content: options.context.content ?? null,
    root,
    resourcesDir,
    executionsDir,
    resources: resources.map((resource) => ({
      key: resource.key,
      type: resource.type,
      dir: resource.dir,
      status: resource.status,
      reason: resource.reason,
      files: resource.files,
      repositoryDir: resource.repositoryDir,
    })),
  })

  return {
    contextId: options.context.id,
    root,
    resourcesDir,
    executionsDir,
    manifestPath,
    resources,
  }
}

export async function prepareExecutionSandbox<Context = unknown>(
  options: PrepareExecutionSandboxOptions<Context>,
): Promise<PreparedExecutionLocal> {
  await prepareContextSandbox({
    sandbox: options.sandbox,
    context: options.context,
    readFile: options.readFile,
    materializeRepository: options.materializeRepository,
  })

  const root = executionRoot({
    basePath: options.sandbox.workspaceRoot,
    contextId: options.context.id,
    executionId: options.executionId,
  })
  const stepsDir = joinSandboxPath(root, "steps")
  const scriptsDir = joinSandboxPath(root, "scripts")
  const outputDir = joinSandboxPath(root, "output")
  const tmpDir = joinSandboxPath(root, "tmp")

  await Promise.all([
    ensureSandboxDir(options.sandbox, stepsDir),
    ensureSandboxDir(options.sandbox, scriptsDir),
    ensureSandboxDir(options.sandbox, outputDir),
    ensureSandboxDir(options.sandbox, tmpDir),
  ])

  const manifestPath = joinSandboxPath(root, "manifest.json")
  await writeSandboxJson(options.sandbox, manifestPath, {
    contextId: options.context.id,
    contextKey: options.context.key,
    executionId: options.executionId,
    triggerEventId: options.triggerEventId,
    reactionEventId: options.reactionEventId,
    root,
    stepsDir,
    scriptsDir,
    outputDir,
    tmpDir,
  })

  return {
    contextId: options.context.id,
    executionId: options.executionId,
    root,
    stepsDir,
    scriptsDir,
    outputDir,
    tmpDir,
    manifestPath,
  }
}

export async function prepareStepPartSandbox(
  options: PrepareStepPartSandboxOptions,
): Promise<PreparedStepPartLocal> {
  const root = stepPartRoot({
    basePath: options.sandbox.workspaceRoot,
    contextId: options.contextId,
    executionId: options.executionId,
    stepId: options.stepId,
    partId: options.partId,
  })
  await ensureSandboxDir(options.sandbox, root)
  const metadataPath = joinSandboxPath(root, "metadata.json")
  await writeSandboxJson(options.sandbox, metadataPath, {
    contextId: options.contextId,
    executionId: options.executionId,
    stepId: options.stepId,
    partId: options.partId,
    ...(options.metadata ?? {}),
  })

  return {
    contextId: options.contextId,
    executionId: options.executionId,
    stepId: options.stepId,
    partId: options.partId,
    root,
    metadataPath,
  }
}

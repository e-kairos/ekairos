import { readInstantFileStep } from "./file/steps.js"
import {
  runDatasetSandboxCommandStep,
  writeDatasetSandboxFilesStep,
  writeDatasetSandboxTextFilesStep,
} from "./sandbox/steps.js"

export type ContextWorkspaceFileRole = "input" | "output" | "artifact"

export type ContextWorkspaceFileInput = {
  fileId: string
  filename?: string
  mediaType?: string
  role?: ContextWorkspaceFileRole
  sourceEventId?: string
  sourcePartIndex?: number
}

export type PreparedContextWorkspaceFile = {
  fileId: string
  filename: string
  mediaType?: string
  role: ContextWorkspaceFileRole
  path: string
  sourceEventId?: string
  sourcePartIndex?: number
}

export type PreparedContextExecutionWorkspace = {
  contextId: string
  executionId: string
  sandboxId: string
  root: string
  contextRoot: string
  eventsDir: string
  outputDir: string
  scriptsDir: string
  tmpDir: string
  manifestPath: string
  files: PreparedContextWorkspaceFile[]
}

const CONTEXT_WORKSPACE_BASE = "/tmp/ekairos/contexts"
const WORKSPACE_MANIFEST_FILE_NAME = "manifest.json"

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function sanitizePathSegment(value: string, fallback: string): string {
  const parts = String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
  const normalized = parts[parts.length - 1]
    ?.replace(/[^a-zA-Z0-9_.-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160)

  return normalized || fallback
}

function filenameFromContentDisposition(value: string | undefined, fallback: string): string {
  const raw = String(value ?? "").trim()
  if (!raw) return fallback

  const filenameStar = raw.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (filenameStar) {
    return sanitizePathSegment(decodeURIComponent(filenameStar), fallback)
  }

  const filename = raw.match(/filename="?([^";]+)"?/i)?.[1]
  return sanitizePathSegment(filename ?? raw, fallback)
}

function resolveContextEventPartDir(params: {
  eventsDir: string
  sourceEventId: string
  sourcePartIndex: number
}) {
  const sourceEventId = sanitizePathSegment(params.sourceEventId, "event")
  const sourcePartIndex = Number.isFinite(params.sourcePartIndex)
    ? Math.max(0, Math.floor(params.sourcePartIndex))
    : 0
  return `${params.eventsDir}/${sourceEventId}/parts/${sourcePartIndex}`
}

function resolveWorkspaceFilePath(params: {
  eventsDir: string
  sourceEventId: string
  sourcePartIndex: number
}) {
  return `${resolveContextEventPartDir(params)}/file`
}

export function getContextWorkspaceBase(): string {
  return trimTrailingSlash(CONTEXT_WORKSPACE_BASE)
}

export function getContextExecutionWorkspaceRoot(params: {
  contextId: string
  executionId: string
  root?: string
}): string {
  if (params.root) return trimTrailingSlash(params.root)
  const contextId = sanitizePathSegment(params.contextId, "context")
  const executionId = sanitizePathSegment(params.executionId, "execution")
  return `${getContextWorkspaceBase()}/${contextId}/executions/${executionId}`
}

export function getContextWorkspaceRoot(params: {
  contextId: string
  root?: string
}): string {
  if (params.root) return trimTrailingSlash(params.root)
  const contextId = sanitizePathSegment(params.contextId, "context")
  return `${getContextWorkspaceBase()}/${contextId}`
}

export function getContextEventsDir(params: {
  contextId: string
  root?: string
}): string {
  return `${getContextWorkspaceRoot(params)}/events`
}

export function getContextExecutionWorkspaceDirs(params: {
  contextId: string
  executionId: string
  root?: string
}) {
  const root = getContextExecutionWorkspaceRoot(params)
  const contextRoot = getContextWorkspaceRoot(params)
  const eventsDir = getContextEventsDir(params)
  return {
    root,
    contextRoot,
    eventsDir,
    outputDir: `${root}/output`,
    scriptsDir: `${root}/scripts`,
    tmpDir: `${root}/tmp`,
    manifestPath: `${root}/${WORKSPACE_MANIFEST_FILE_NAME}`,
  }
}

export function getContextExecutionWorkspaceStandardDirs(params: {
  contextId: string
  executionId: string
  root?: string
}): string[] {
  const dirs = getContextExecutionWorkspaceDirs(params)
  return [dirs.contextRoot, dirs.eventsDir, dirs.root, dirs.outputDir, dirs.scriptsDir, dirs.tmpDir]
}

export function extractContextWorkspaceFilesFromEventItems(
  eventItems: unknown[],
): ContextWorkspaceFileInput[] {
  const files: ContextWorkspaceFileInput[] = []

  for (const item of eventItems) {
    const itemRecord = asRecord(item)
    const parts = Array.isArray(asRecord(itemRecord?.content)?.parts)
      ? (asRecord(itemRecord?.content)?.parts as unknown[])
      : []

    parts.forEach((part, partIndex) => {
      collectPartFiles(part, {
        files,
        sourceEventId: asText(itemRecord?.id),
        sourcePartIndex: partIndex,
      })
    })
  }

  return files
}

export async function prepareContextExecutionWorkspaceStep(params: {
  runtime: any
  sandboxId: string
  contextId: string
  executionId: string
  files: ContextWorkspaceFileInput[]
  root?: string
}): Promise<PreparedContextExecutionWorkspace> {
  "use step"

  const dirs = getContextExecutionWorkspaceDirs(params)
  const filePartDirs = Array.from(
    new Set(
      params.files.map((fileInput) =>
        resolveContextEventPartDir({
          eventsDir: dirs.eventsDir,
          sourceEventId: fileInput.sourceEventId ?? fileInput.fileId,
          sourcePartIndex: fileInput.sourcePartIndex ?? 0,
        }),
      ),
    ),
  )

  await runDatasetSandboxCommandStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    cmd: "mkdir",
    args: ["-p", ...getContextExecutionWorkspaceStandardDirs(params), ...filePartDirs],
  })

  const preparedFiles: PreparedContextWorkspaceFile[] = []

  for (const fileInput of params.files) {
    const fileId = String(fileInput.fileId ?? "").trim()
    if (!fileId) continue

    const file = await readInstantFileStep({ runtime: params.runtime, fileId })
    const filename = sanitizePathSegment(
      fileInput.filename ??
        filenameFromContentDisposition(file.contentDisposition, `${fileId}.bin`),
      `${fileId}.bin`,
    )
    const path = resolveWorkspaceFilePath({
      eventsDir: dirs.eventsDir,
      sourceEventId: fileInput.sourceEventId ?? fileId,
      sourcePartIndex: fileInput.sourcePartIndex ?? 0,
    })
    const metadataPath = `${resolveContextEventPartDir({
      eventsDir: dirs.eventsDir,
      sourceEventId: fileInput.sourceEventId ?? fileId,
      sourcePartIndex: fileInput.sourcePartIndex ?? 0,
    })}/metadata.json`

    await writeDatasetSandboxFilesStep({
      runtime: params.runtime,
      sandboxId: params.sandboxId,
      files: [{ path, contentBase64: file.contentBase64 }],
    })
    await writeDatasetSandboxTextFilesStep({
      runtime: params.runtime,
      sandboxId: params.sandboxId,
      files: [
        {
          path: metadataPath,
          content: JSON.stringify(
            {
              fileId,
              filename,
              mediaType: fileInput.mediaType,
              role: fileInput.role ?? "input",
              sourceEventId: fileInput.sourceEventId,
              sourcePartIndex: fileInput.sourcePartIndex,
            },
            null,
            2,
          ),
        },
      ],
    })

    preparedFiles.push({
      fileId,
      filename,
      mediaType: fileInput.mediaType,
      role: fileInput.role ?? "input",
      path,
      sourceEventId: fileInput.sourceEventId,
      sourcePartIndex: fileInput.sourcePartIndex,
    })
  }

  const manifest: PreparedContextExecutionWorkspace = {
    contextId: params.contextId,
    executionId: params.executionId,
    sandboxId: params.sandboxId,
    ...dirs,
    files: preparedFiles,
  }

  await writeDatasetSandboxTextFilesStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    files: [
      {
        path: dirs.manifestPath,
        content: JSON.stringify(manifest, null, 2),
      },
    ],
  })

  return manifest
}

function collectPartFiles(
  value: unknown,
  params: {
    files: ContextWorkspaceFileInput[]
    sourceEventId?: string
    sourcePartIndex: number
  },
) {
  const record = asRecord(value)
  if (!record) return

  if (record.type === "file") {
    pushFileRecord(record, params)
    return
  }

  const content = asRecord(record.content)
  if (!content) return

  if (Array.isArray(content.blocks)) {
    for (const block of content.blocks) {
      const blockRecord = asRecord(block)
      if (blockRecord?.type === "file") {
        pushFileRecord(blockRecord, params)
      }
    }
  }
}

function pushFileRecord(
  record: Record<string, unknown>,
  params: {
    files: ContextWorkspaceFileInput[]
    sourceEventId?: string
    sourcePartIndex: number
  },
) {
  const fileId = asText(record.fileId)
  if (!fileId) return

  params.files.push({
    fileId,
    filename: asText(record.filename),
    mediaType: asText(record.mediaType),
    role: "input",
    sourceEventId: params.sourceEventId,
    sourcePartIndex: params.sourcePartIndex,
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

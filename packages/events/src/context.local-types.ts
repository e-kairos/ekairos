import type { StoredContext, StoredContextResource } from "./context.store.js"

export type ContextLocalFileMaterial = {
  fileId: string
  filename?: string
  mediaType?: string
  content?: string | Uint8Array
  contentBase64?: string
}

export type ContextLocalFileReader = (
  resource: StoredContextResource,
) => Promise<ContextLocalFileMaterial | null> | ContextLocalFileMaterial | null

export type ContextLocalRepositoryMaterializer = (
  resource: StoredContextResource,
  repositoryDir: string,
) => Promise<void> | void

export type PrepareContextLocalOptions<Context = unknown> = {
  basePath: string
  context: Pick<StoredContext<Context>, "id" | "key" | "content" | "resources">
  readFile?: ContextLocalFileReader
  materializeRepository?: ContextLocalRepositoryMaterializer
}

export type PrepareExecutionLocalOptions<Context = unknown> = {
  basePath: string
  context: Pick<StoredContext<Context>, "id" | "key" | "content" | "resources">
  executionId: string
  triggerEventId?: string
  reactionEventId?: string
  readFile?: ContextLocalFileReader
  materializeRepository?: ContextLocalRepositoryMaterializer
}

export type PrepareStepPartLocalOptions = {
  basePath: string
  contextId: string
  executionId: string
  stepId: string
  partId: string
  metadata?: Record<string, unknown> | null
}

export type PreparedContextResourceFile = {
  fileId: string
  filename: string
  path: string
  mediaType?: string
}

export type PreparedContextResource = {
  key: string
  type: string
  dir: string
  metadataPath: string
  status: "materialized" | "metadata_only"
  reason?: string
  files: PreparedContextResourceFile[]
  repositoryDir?: string
}

export type PreparedContextLocal = {
  contextId: string
  root: string
  resourcesDir: string
  executionsDir: string
  manifestPath: string
  resources: PreparedContextResource[]
}

export type PreparedExecutionLocal = {
  contextId: string
  executionId: string
  root: string
  stepsDir: string
  scriptsDir: string
  outputDir: string
  tmpDir: string
  manifestPath: string
}

export type PreparedStepPartLocal = {
  contextId: string
  executionId: string
  stepId: string
  partId: string
  root: string
  metadataPath: string
}

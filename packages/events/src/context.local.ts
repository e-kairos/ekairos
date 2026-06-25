import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import {
  getContextExecutionLocalRoot,
  getContextLocalRoot,
  getContextPartLocalRoot,
} from "./context.local-paths.js"
import { materializeContextResource } from "./context.local-resources.js"
import type {
  PreparedContextLocal,
  PreparedExecutionLocal,
  PreparedStepPartLocal,
  PrepareContextLocalOptions,
  PrepareExecutionLocalOptions,
  PrepareStepPartLocalOptions,
} from "./context.local-types.js"
import { writeContextLocalJson } from "./context.local-io.js"

export {
  CONTEXT_LOCAL_SEGMENT_MAX_LENGTH,
  getContextExecutionLocalRoot,
  getContextLocalRoot,
  getContextPartLocalRoot,
  getContextResourceLocalRoot,
  getContextStepLocalRoot,
  safeContextLocalFilename,
  safeContextLocalSegment,
  safeContextResourceLocalSegment,
} from "./context.local-paths.js"

export type {
  ContextLocalFileMaterial,
  ContextLocalFileReader,
  ContextLocalRepositoryMaterializer,
  PreparedContextLocal,
  PreparedContextResource,
  PreparedContextResourceFile,
  PreparedExecutionLocal,
  PreparedStepPartLocal,
  PrepareContextLocalOptions,
  PrepareExecutionLocalOptions,
  PrepareStepPartLocalOptions,
} from "./context.local-types.js"

export async function prepareContextLocal<Context = unknown>(
  options: PrepareContextLocalOptions<Context>,
): Promise<PreparedContextLocal> {
  const root = getContextLocalRoot({
    basePath: options.basePath,
    contextId: options.context.id,
  })
  const resourcesDir = join(root, "resources")
  const executionsDir = join(root, "executions")
  await mkdir(resourcesDir, { recursive: true })
  await mkdir(executionsDir, { recursive: true })

  const resources = []
  for (const resource of options.context.resources ?? []) {
    resources.push(
      await materializeContextResource({
        resourcesDir,
        resource,
        readFile: options.readFile,
        materializeRepository: options.materializeRepository,
      }),
    )
  }

  const manifestPath = join(root, "manifest.json")
  await writeContextLocalJson(manifestPath, {
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

export async function prepareExecutionLocal<Context = unknown>(
  options: PrepareExecutionLocalOptions<Context>,
): Promise<PreparedExecutionLocal> {
  await prepareContextLocal({
    basePath: options.basePath,
    context: options.context,
    readFile: options.readFile,
    materializeRepository: options.materializeRepository,
  })

  const root = getContextExecutionLocalRoot({
    basePath: options.basePath,
    contextId: options.context.id,
    executionId: options.executionId,
  })
  const stepsDir = join(root, "steps")
  const scriptsDir = join(root, "scripts")
  const outputDir = join(root, "output")
  const tmpDir = join(root, "tmp")

  await Promise.all([
    mkdir(stepsDir, { recursive: true }),
    mkdir(scriptsDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
    mkdir(tmpDir, { recursive: true }),
  ])

  const manifestPath = join(root, "manifest.json")
  await writeContextLocalJson(manifestPath, {
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

export async function prepareStepPartLocal(
  options: PrepareStepPartLocalOptions,
): Promise<PreparedStepPartLocal> {
  const root = getContextPartLocalRoot({
    basePath: options.basePath,
    contextId: options.contextId,
    executionId: options.executionId,
    stepId: options.stepId,
    partId: options.partId,
  })
  await mkdir(root, { recursive: true })
  const metadataPath = join(root, "metadata.json")
  await writeContextLocalJson(metadataPath, {
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

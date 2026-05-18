import { DATASET_OUTPUT_FILE_NAME } from "../datasetFiles.js"
import { prepareContextExecutionWorkspaceStep } from "../contextWorkspace.js"
import { buildFileDatasetPrompt } from "./prompts.js"
import { generateFilePreview } from "./filepreview.js"
import type { FileParseContext, SandboxState } from "./file-dataset.types.js"
import type { FilePreviewContext } from "./filepreview.types.js"

export async function initializeFileParseSandboxStep(params: {
  runtime: any
  sandboxId: string
  contextId: string
  executionId: string
  datasetId: string
  fileId: string
  sourceEventId?: string
  sourcePartIndex?: number
  filename?: string
  mediaType?: string
  state: SandboxState
}): Promise<{ filePath: string; state: SandboxState }> {
  "use step"

  if (params.state.initialized) {
    return { filePath: params.state.filePath, state: params.state }
  }

  console.log(`[FileParseContext ${params.datasetId}] Preparing context execution workspace...`)

  const workspace = await prepareContextExecutionWorkspaceStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    contextId: params.contextId,
    executionId: params.executionId,
    files: [
      {
        fileId: params.fileId,
        filename: params.filename,
        mediaType: params.mediaType,
        sourceEventId: params.sourceEventId,
        sourcePartIndex: params.sourcePartIndex,
      },
    ],
  })
  const sandboxFilePath = workspace.files[0]?.path ?? ""
  if (!sandboxFilePath) throw new Error("dataset_workspace_file_missing")

  console.log(`[FileParseContext ${params.datasetId}] Context workspace created: ${workspace.root}`)
  console.log(`[FileParseContext ${params.datasetId}] File saved: ${sandboxFilePath}`)

  const state = {
    initialized: true,
    filePath: sandboxFilePath,
    outputPath: `${workspace.outputDir}/${DATASET_OUTPUT_FILE_NAME}`,
    scriptsDir: workspace.scriptsDir,
    manifestPath: workspace.manifestPath,
  }

  return { filePath: sandboxFilePath, state }
}

export async function generateFileParsePreviewStep(params: {
  runtime: any
  sandboxId: string
  sandboxFilePath: string
  datasetId: string
}): Promise<FilePreviewContext> {
  "use step"

  return await generateFilePreview(
    params.runtime,
    params.sandboxId,
    params.sandboxFilePath,
    params.datasetId,
  )
}

export async function buildFileDatasetPromptStep(params: {
  context: FileParseContext
}): Promise<string> {
  "use step"

  return buildFileDatasetPrompt(params.context)
}

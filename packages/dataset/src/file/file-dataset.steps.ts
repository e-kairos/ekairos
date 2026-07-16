import { DATASET_OUTPUT_FILE_NAME } from "../datasetFiles.js"
import { prepareContextSessionWorkspaceStep } from "../contextWorkspace.js"
import { writeDatasetSandboxTextFilesStep } from "../sandbox/steps.js"
import { buildFileDatasetPrompt } from "./prompts.js"
import { generateFilePreview } from "./filepreview.js"
import type { FileParseContext, SandboxState } from "./file-dataset.types.js"
import type { FilePreviewContext } from "./filepreview.types.js"

export async function initializeFileParseSandboxStep(params: {
  runtime: any
  sandboxId: string
  contextId: string
  sessionId: string
  datasetId: string
  fileId: string
  sourceEventId?: string
  sourcePartIndex?: number
  filename?: string
  mediaType?: string
  instructions?: string
  state: SandboxState
}): Promise<{ filePath: string; state: SandboxState }> {
  "use step"

  if (params.state.initialized) {
    if (params.state.contextPath) {
      await writeDatasetSandboxTextFilesStep({
        runtime: params.runtime,
        sandboxId: params.sandboxId,
        files: [{ path: params.state.contextPath, content: params.instructions ?? "" }],
      })
    }
    return { filePath: params.state.filePath, state: params.state }
  }

  console.log(`[FileParseContext ${params.datasetId}] Preparing context session workspace...`)

  const workspace = await prepareContextSessionWorkspaceStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    contextId: params.contextId,
    sessionId: params.sessionId,
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
  const contextPath = `${workspace.root}/context.md`

  await writeDatasetSandboxTextFilesStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    files: [{ path: contextPath, content: params.instructions ?? "" }],
  })

  console.log(`[FileParseContext ${params.datasetId}] Context workspace created: ${workspace.root}`)
  console.log(`[FileParseContext ${params.datasetId}] File saved: ${sandboxFilePath}`)

  const state = {
    initialized: true,
    filePath: sandboxFilePath,
    contextPath,
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

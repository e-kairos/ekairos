import {
  getDatasetOutputPath,
  getDatasetResourcesDir,
  getDatasetStandardDirs,
} from "../datasetFiles.js"
import { datasetReadOutputJsonlStep } from "../dataset/steps.js"
import { runDatasetSandboxCommandStep, writeDatasetSandboxFilesStep } from "../sandbox/steps.js"
import { generateInputPreview } from "./filepreview.js"
import { buildTransformDatasetPrompt } from "./prompts.js"
import type {
  TransformPromptContext,
  TransformSandboxState,
  TransformInputPreviewContext,
} from "./transform-dataset.types.js"

export async function ensureTransformInputsInSandboxStep(params: {
  runtime: any
  sandboxId: string
  datasetId: string
  inputDatasetIds: string[]
  state: TransformSandboxState
}): Promise<{
  inputPaths: Array<{ datasetId: string; path: string }>
  outputPath: string
  state: TransformSandboxState
}> {
  "use step"

  if (params.state.initialized) {
    return {
      inputPaths: params.state.inputPaths,
      outputPath: getDatasetOutputPath(params.datasetId),
      state: params.state,
    }
  }

  await runDatasetSandboxCommandStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    cmd: "mkdir",
    args: ["-p", ...getDatasetStandardDirs(params.datasetId)],
  })

  const inputPaths: Array<{ datasetId: string; path: string }> = []

  for (const inputDatasetId of params.inputDatasetIds) {
    const inputPath = `${getDatasetResourcesDir(params.datasetId)}/resource_${inputDatasetId}.jsonl`

    const input = await datasetReadOutputJsonlStep({
      runtime: params.runtime,
      datasetId: inputDatasetId,
    })
    await writeDatasetSandboxFilesStep({
      runtime: params.runtime,
      sandboxId: params.sandboxId,
      files: [{ path: inputPath, contentBase64: input.contentBase64 }],
    })

    inputPaths.push({ datasetId: inputDatasetId, path: inputPath })
  }

  return {
    inputPaths,
    outputPath: getDatasetOutputPath(params.datasetId),
    state: {
      initialized: true,
      inputPaths,
    },
  }
}

export async function generateTransformInputPreviewsStep(params: {
  runtime: any
  sandboxId: string
  datasetId: string
  inputPaths: Array<{ datasetId: string; path: string }>
}): Promise<Array<{ datasetId: string; preview: TransformInputPreviewContext }>> {
  "use step"

  const inputPreviews: Array<{ datasetId: string; preview: TransformInputPreviewContext }> = []
  for (const inputPath of params.inputPaths) {
    try {
      const preview = await generateInputPreview(
        params.runtime,
        params.sandboxId,
        inputPath.path,
        params.datasetId,
      )
      inputPreviews.push({ datasetId: inputPath.datasetId, preview })
    } catch {
      // Input preview is optional; transformation can still read the JSONL files.
    }
  }
  return inputPreviews
}

export async function buildTransformDatasetPromptStep(params: {
  context: TransformPromptContext
}): Promise<string> {
  "use step"

  return buildTransformDatasetPrompt(params.context)
}

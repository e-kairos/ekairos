import { defineAction, type DomainActionDefinition } from "@ekairos/domain"
import { z } from "zod"

import { getDatasetOutputPath } from "./datasetFiles.js"
import { buildFileDatasetPromptStep, initializeFileParseSandboxStep } from "./file/file-dataset.steps.js"
import { buildTransformDatasetPromptStep } from "./transform/transform-dataset.steps.js"

function withUserInstructions(base: string, instructions: string | undefined) {
  const userInstructions = String(instructions ?? "").trim()
  if (!userInstructions) return base
  return [
    "## USER INSTRUCTIONS",
    "Apply these instructions in addition to, and with higher priority than, the defaults.",
    "",
    userInstructions,
    "",
    base,
  ].join("\n")
}

export const prepareFileMaterializationInputSchema = z.object({
  contextId: z.string(),
  sessionId: z.string(),
  sourceEventId: z.string(),
  datasetId: z.string(),
  fileId: z.string(),
  sandboxId: z.string(),
  instructions: z.string().optional(),
  sandboxState: z.unknown(),
  filePreview: z.unknown().optional(),
  schema: z.unknown().optional(),
  filename: z.string().optional(),
  mediaType: z.string().optional(),
})

export const prepareFileMaterializationOutputSchema = z.object({
  instructions: z.string(),
  promptContext: z.record(z.string(), z.unknown()),
  sandboxState: z.unknown(),
})

export const prepareFileMaterialization: DomainActionDefinition<
  typeof prepareFileMaterializationInputSchema,
  typeof prepareFileMaterializationOutputSchema
> = defineAction({
  description: "Prepare one file-backed dataset materialization and its model context.",
  input: prepareFileMaterializationInputSchema,
  output: prepareFileMaterializationOutputSchema,
  execute: async ({ input, runtime }) => {
    const initialized = await initializeFileParseSandboxStep({
      runtime,
      sandboxId: input.sandboxId,
      contextId: input.contextId,
      sessionId: input.sessionId,
      datasetId: input.datasetId,
      fileId: input.fileId,
      sourceEventId: input.sourceEventId,
      sourcePartIndex: 1,
      filename: input.filename,
      mediaType: input.mediaType,
      instructions: input.instructions,
      state: input.sandboxState as any,
    })
    const promptContext = {
      datasetId: input.datasetId,
      fileId: input.fileId,
      instructions: input.instructions ?? "",
      sandboxConfig: {
        filePath: initialized.filePath,
        contextPath: initialized.state.contextPath,
        outputPath: initialized.state.outputPath,
        scriptsDir: initialized.state.scriptsDir,
        manifestPath: initialized.state.manifestPath,
      },
      analysis: [],
      schema: input.schema,
      plan: null,
      executionResult: null,
      errors: [],
      iterationCount: 0,
      filePreview: input.filePreview,
    }
    const basePrompt = await buildFileDatasetPromptStep({ context: promptContext as any })
    return {
      instructions: withUserInstructions(basePrompt, input.instructions),
      promptContext,
      sandboxState: initialized.state,
    }
  },
})

export const prepareTransformMaterializationInputSchema = z.object({
  datasetId: z.string(),
  inputDatasetIds: z.array(z.string()),
  outputSchema: z.unknown(),
  instructions: z.string().optional(),
  sandboxId: z.string(),
  sandboxState: z.unknown(),
  inputPreviews: z.unknown().optional(),
  sources: z.array(z.unknown()).default([]),
})

export const prepareTransformMaterializationOutputSchema = z.object({
  instructions: z.string(),
  promptContext: z.record(z.string(), z.unknown()),
})

export const prepareTransformMaterialization: DomainActionDefinition<
  typeof prepareTransformMaterializationInputSchema,
  typeof prepareTransformMaterializationOutputSchema
> = defineAction({
  description: "Prepare one derived dataset materialization and its model context.",
  input: prepareTransformMaterializationInputSchema,
  output: prepareTransformMaterializationOutputSchema,
  execute: async ({ input }) => {
    const promptContext = {
      datasetId: input.datasetId,
      inputDatasetIds: input.inputDatasetIds,
      outputSchema: input.outputSchema,
      sandboxConfig: {
        inputPaths: (input.sandboxState as any)?.inputPaths ?? [],
        outputPath: getDatasetOutputPath(input.datasetId),
      },
      inputPreviews: input.inputPreviews,
      sources: input.sources,
      errors: [],
    }
    const basePrompt = await buildTransformDatasetPromptStep({
      context: promptContext as any,
    })
    return {
      instructions: withUserInstructions(basePrompt, input.instructions),
      promptContext,
    }
  },
})

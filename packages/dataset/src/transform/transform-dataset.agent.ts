import {
  createContext,
  INPUT_TEXT_ITEM_TYPE,
  WEB_CHANNEL,
  type ContextReactor,
} from "@ekairos/events"

import { createClearDatasetTool } from "../clearDataset.tool.js"
import {
  createCompleteDatasetTool,
  didCompleteDatasetSucceed,
  getDatasetFatalFailure,
} from "../completeDataset.tool.js"
import { datasetUpdateSchemaStep } from "../dataset/steps.js"
import { getDatasetOutputPath } from "../datasetFiles.js"
import { createExecuteCommandTool } from "../executeCommand.tool.js"
import {
  buildTransformDatasetPromptStep,
  ensureTransformInputsInSandboxStep,
  generateTransformInputPreviewsStep,
} from "./transform-dataset.steps.js"
import { createDatasetId } from "../id.js"
import type {
  TransformDatasetAgentParams,
  TransformDatasetContext,
  TransformDatasetResult,
  TransformDatasetRunOptions,
  TransformPromptContext,
  TransformSandboxState,
  TransformInputPreviewContext,
} from "./transform-dataset.types.js"

export type {
  TransformDatasetAgentParams,
  TransformDatasetContext,
  TransformDatasetResult,
  TransformDatasetRunOptions,
  TransformPromptContext,
  TransformSandboxState,
} from "./transform-dataset.types.js"

async function awaitContextRun(run: any) {
  if (!run) return
  if (run.returnValue) {
    await run.returnValue
    return
  }
  await run
}

function createTransformDatasetContextDefinition<Env extends { orgId: string }>(
  params: TransformDatasetAgentParams,
): { datasetId: string; context: any } {
  const fallbackDatasetId = params.datasetId
  const model = params.model ?? "openai/gpt-5"

  let contextBuilder = createContext<Env>("dataset.transform")
    .context(async (stored: any, _env: Env, runtime: any) => {
      const previous = (stored?.content as any) ?? {}
      const sandboxState: TransformSandboxState =
        previous?.sandboxState ??
        params.sandboxState ?? { initialized: false, inputPaths: [] }
      const datasetId: string = previous?.datasetId ?? fallbackDatasetId ?? ""
      const inputDatasetIds: string[] = Array.isArray(previous?.inputDatasetIds)
        ? previous.inputDatasetIds
        : Array.isArray(params.inputDatasetIds)
          ? params.inputDatasetIds
          : []
      const outputSchema = previous?.outputSchema ?? params.outputSchema
      const instructions = previous?.instructions ?? params.instructions
      const sandboxId: string = previous?.sandboxId ?? params.sandboxId ?? ""
      if (!datasetId) {
        throw new Error("dataset_id_required")
      }
      if (inputDatasetIds.length === 0) {
        throw new Error("dataset_transform_inputs_required")
      }
      if (!outputSchema) {
        throw new Error("dataset_transform_schema_required")
      }
      if (!sandboxId) {
        throw new Error("dataset_sandbox_required")
      }

      const initialized =
        sandboxState.initialized && Array.isArray(sandboxState.inputPaths)
          ? {
              inputPaths: sandboxState.inputPaths,
              outputPath: previous?.sandboxConfig?.outputPath ?? getDatasetOutputPath(datasetId),
              state: sandboxState,
            }
          : await ensureTransformInputsInSandboxStep({
              runtime,
              sandboxId,
              datasetId,
              inputDatasetIds,
              state: sandboxState,
            })

      let inputPreviews =
        previous?.inputPreviews ?? params.inputPreviews ?? undefined
      if (!inputPreviews) {
        inputPreviews = await generateTransformInputPreviewsStep({
          runtime,
          sandboxId,
          datasetId,
          inputPaths: initialized.inputPaths,
        })
      }

      await datasetUpdateSchemaStep({
        runtime,
        datasetId,
        schema: outputSchema,
        status: "schema_complete",
      })

      const promptContext: TransformPromptContext = {
        datasetId,
        inputDatasetIds,
        outputSchema,
        sandboxConfig: {
          inputPaths: initialized.inputPaths,
          outputPath: initialized.outputPath,
        },
        inputPreviews: inputPreviews.length > 0 ? inputPreviews : undefined,
        errors: [],
      }

      const basePrompt = await buildTransformDatasetPromptStep({
        context: promptContext,
      })
      const userInstructions = String(instructions ?? "").trim()
      const system = userInstructions
        ? [
            "## USER INSTRUCTIONS",
            "The following instructions were provided by the user. Apply them in addition to (and with higher priority than) the default instructions.",
            "",
            userInstructions,
            "",
            basePrompt,
          ].join("\n")
        : basePrompt

      return {
        ...previous,
        datasetId,
        inputDatasetIds,
        outputSchema,
        instructions,
        sandboxId,
        sandboxState: initialized.state,
        system,
        sandboxConfig: {
          inputPaths: initialized.inputPaths,
          outputPath: initialized.outputPath,
        },
      }
    })
    .narrative(async (stored: any) => {
      return String(stored?.content?.system ?? "")
    })
    .actions(async (stored: any, _env: Env, runtime: any) => {
      const datasetId: string = stored?.content?.datasetId ?? fallbackDatasetId ?? ""
      const sandboxId = (stored?.content?.sandboxId as string) ?? params.sandboxId ?? ""
      if (!datasetId) throw new Error("dataset_id_required")
      if (!sandboxId) throw new Error("dataset_sandbox_required")
      return {
        executeCommand: createExecuteCommandTool({
          datasetId,
          sandboxId,
          runtime,
        }),
        completeDataset: createCompleteDatasetTool({
          datasetId,
          sandboxId,
          runtime,
        }),
        clearDataset: createClearDatasetTool({
          datasetId,
          sandboxId,
          runtime,
        }),
      } as any
    })
    .shouldContinue(({ reactionEvent }: { reactionEvent: any }) => {
      const fatalFailure = getDatasetFatalFailure(reactionEvent as any)
      if (fatalFailure) {
        throw new Error(fatalFailure)
      }
      return !didCompleteDatasetSucceed(reactionEvent as any)
    })

  if (params.reactor) {
    contextBuilder = contextBuilder.reactor(params.reactor as any)
  } else {
    contextBuilder = contextBuilder.model(model)
  }

  const context = contextBuilder.build()

  return { datasetId: fallbackDatasetId ?? "", context }
}

export function createTransformDatasetContext<Env extends { orgId: string }>(
  params: {
    inputDatasetIds: string[]
    outputSchema: any
    instructions?: string
    datasetId?: string
    model?: string
    sandboxId?: string
    reactor?: ContextReactor<any, any>
    sandboxState?: TransformSandboxState
    inputPreviews?: Array<{ datasetId: string; preview: TransformInputPreviewContext }>
  },
) {
  const datasetId = params.datasetId ?? createDatasetId()
  const { context } = createTransformDatasetContextDefinition<Env>({
    inputDatasetIds: params.inputDatasetIds,
    outputSchema: params.outputSchema,
    instructions: params.instructions,
    datasetId,
    model: params.model,
    sandboxId: params.sandboxId,
    reactor: params.reactor,
    sandboxState: params.sandboxState,
    inputPreviews: params.inputPreviews,
  })

  return {
    datasetId,
    async transform(
      runtime: { env: Env },
      options: TransformDatasetRunOptions = {},
    ): Promise<{ datasetId: string }> {
      const datasetCountText =
        params.inputDatasetIds.length === 1
          ? "the input dataset"
          : `${params.inputDatasetIds.length} input datasets`

      const triggerEvent = {
        id: createDatasetId(),
        type: INPUT_TEXT_ITEM_TYPE,
        channel: WEB_CHANNEL,
        createdAt: new Date().toISOString(),
        content: {
          parts: [
            {
              type: "text",
              text:
                options.prompt ??
                `Transform ${datasetCountText} into a new dataset matching the provided output schema`,
            },
          ],
        },
      } as any

      const shell = await context.react(triggerEvent, {
        runtime: runtime as any,
        context: { key: `dataset:${datasetId}` },
        durable: options.durable ?? false,
        options: {
          preventClose: true,
          sendFinish: false,
          maxIterations: 20,
          maxModelSteps: 5,
        },
        __initialContent: {
          ...(options.initialContent ?? {}),
          datasetId,
          inputDatasetIds: params.inputDatasetIds,
          outputSchema: params.outputSchema,
          instructions: params.instructions,
          sandboxId: params.sandboxId ?? "",
          sandboxState: params.sandboxState ?? { initialized: false, inputPaths: [] },
          inputPreviews: params.inputPreviews,
        },
      })
      await awaitContextRun(shell.run)

      return { datasetId }
    },
    context,
  }
}

export function registerTransformDatasetContext<Env extends { orgId: string }>(
  opts?: {
    model?: string
    reactor?: ContextReactor<any, any>
  },
) {
  createTransformDatasetContextDefinition<Env>({
    model: opts?.model,
    reactor: opts?.reactor,
  }).context
}

registerTransformDatasetContext()

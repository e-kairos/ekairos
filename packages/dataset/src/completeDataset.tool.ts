import { defineAction, type DomainActionDefinition } from "@ekairos/domain"
import { z } from "zod"

import { persistDatasetStep } from "./completeDataset.steps.js"

export const completeDatasetInputSchema = z.object({
  datasetId: z.string(),
  sandboxId: z.string(),
  outputPath: z.string().optional(),
  summary: z
    .string()
    .describe("Summary of the completed dataset including record count and structure"),
})

export const completeDatasetOutputSchema = z
  .object({
    success: z.boolean(),
    status: z.string().optional(),
    rowSource: z.string(),
    outputPath: z.string().nullable(),
    storagePath: z.string().nullable(),
    summary: z.string().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough()

export const completeDataset: DomainActionDefinition<
  typeof completeDatasetInputSchema,
  typeof completeDatasetOutputSchema
> = defineAction({
  description:
    "Validate and complete the dataset from output.jsonl. The result includes the JSONL outputPath and storagePath used for completion.",
  input: completeDatasetInputSchema,
  output: completeDatasetOutputSchema,
  execute: async ({ input, runtime }) => {
    const { datasetId, sandboxId, summary, outputPath } = input

    console.log(`[Dataset ${datasetId}] ========================================`)
    console.log(`[Dataset ${datasetId}] Action: completeDataset`)
    console.log(`[Dataset ${datasetId}] Summary: ${summary}`)
    console.log(`[Dataset ${datasetId}] ========================================`)

    return await persistDatasetStep({
      runtime,
      datasetId,
      sandboxId,
      summary,
      outputPath,
    })
  },
})

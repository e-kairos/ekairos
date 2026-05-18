import { tool } from "ai"
import { z } from "zod"
import { persistDatasetStep } from "./completeDataset.steps.js"

interface CompleteDatasetToolParams {
    datasetId: string
    sandboxId: string
    runtime: any
    outputPath?: string
}

export function createCompleteDatasetTool({ datasetId, sandboxId, runtime, outputPath }: CompleteDatasetToolParams) {
    return tool({
        description: "Mark the dataset as completed. Use only when output.jsonl has been successfully generated and is ready for validation.",
        inputSchema: z.object({
            summary: z.string().describe("Summary of the completed dataset including record count and structure"),
        }),
        execute: async ({ summary }: { summary: string }) => {
            console.log(`[Dataset ${datasetId}] ========================================`)
            console.log(`[Dataset ${datasetId}] Tool: completeDataset`)
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
}

export function didCompleteDatasetSucceed(event: { content?: { parts?: any[] } }): boolean {
    const parts = Array.isArray(event?.content?.parts) ? event.content.parts : []

    return parts.some((part) => {
        if (part?.type === "action" && part?.content?.actionName === "completeDataset") {
            const output = part.content.output
            return part.content.status === "completed" && output?.success === true && output?.status === "completed"
        }

        if (part?.type === "tool-completeDataset") {
            const output = part.output ?? part.result
            return part.state === "output-available" && output?.success === true && output?.status === "completed"
        }

        return false
    })
}

export function getDatasetFatalFailure(event: { content?: { parts?: any[] } }): string | null {
    const parts = Array.isArray(event?.content?.parts) ? event.content.parts : []

    for (const part of parts) {
        let actionName: string | undefined
        let output: any

        if (part?.type === "action") {
            actionName = part.content?.actionName
            output = part.content?.output
        } else if (typeof part?.type === "string" && part.type.startsWith("tool-")) {
            actionName = part.type.slice("tool-".length)
            output = part.output ?? part.result
        }

        if (!output || output.fatal !== true) {
            continue
        }

        const message =
            typeof output.error === "string" && output.error.trim()
                ? output.error.trim()
                : typeof output.message === "string" && output.message.trim()
                    ? output.message.trim()
                    : "Dataset action failed fatally"

        return actionName ? `${actionName}: ${message}` : message
    }

    return null
}

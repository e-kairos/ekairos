import { z } from "zod"

import {
  DocumentNotReadyError,
  documents,
  type DocumentsConfig,
  type DocumentsRuntime,
} from "./documents.js"

export type DocumentActionsOptions = {
  /** Hard cap on content returned to the model per call. Default 60_000. */
  maxChars?: number
} & DocumentsConfig

const DEFAULT_ACTION_MAX_CHARS = 60_000

const documentReadInput = z.object({
  fileId: z
    .string()
    .optional()
    .describe("Id of an attached file to read. Formalizes it on first read."),
  documentId: z
    .string()
    .optional()
    .describe("Id of an already formalized document."),
  pages: z
    .array(z.number().int().min(1))
    .optional()
    .describe(
      "1-based page numbers to read. Omit to read the whole document.",
    ),
})

/**
 * Model-facing query actions over the documents domain. Wrap these adapters in
 * an application-owned domain action before exposing them to a Reaction:
 *
 * ```ts
 * const answer = await reaction.given(current).agent({
 *   instruction,
 *   actions: [application.actions.readDocument],
 *   output,
 * })
 * ```
 *
 * The returned objects follow the AI SDK tool shape
 * (`{ description, inputSchema, execute }`). Reactions accept registered domain
 * actions instead, so expose document reads through an action owned by the app
 * domain when a reaction needs model-directed document access.
 */
export function documentActions(
  runtime: DocumentsRuntime,
  options: DocumentActionsOptions = {},
) {
  const { maxChars, ...config } = options
  const api = documents(runtime, config)
  const cap = maxChars ?? DEFAULT_ACTION_MAX_CHARS

  return {
    document_read: {
      description:
        "Read the content of an attached file or a formalized document. " +
        "Pass fileId for an attachment (it is parsed and persisted as a document " +
        "on first read) or documentId for an existing document. Optionally pass " +
        "1-based page numbers to read a subset of a long document.",
      inputSchema: documentReadInput,
      execute: async (input: z.infer<typeof documentReadInput>) => {
        if (!input.fileId && !input.documentId) {
          return { error: "Provide fileId or documentId." }
        }
        try {
          const result = await api.read(
            input.documentId
              ? { documentId: input.documentId }
              : { fileId: input.fileId as string },
            {
              pages: input.pages?.map((page) => page - 1),
              maxChars: cap,
            },
          )
          return result
        } catch (error) {
          if (error instanceof DocumentNotReadyError) {
            return {
              error: `Document is not ready (status: ${error.status}). Retry later or re-read the file.`,
              documentId: error.documentId,
            }
          }
          return {
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
    },
  }
}

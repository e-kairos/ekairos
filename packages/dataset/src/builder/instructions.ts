import type { DatasetSchemaInput } from "./types.js"

export function buildFileDefaultInstructions(schema?: DatasetSchemaInput) {
  if (schema) {
    return "Create a dataset from the resource file and ensure each output row matches the provided dataset schema exactly."
  }
  return "Create a dataset representing the resource content as structured rows."
}

export function buildRawResourceInstructions(resourceKind: "file" | "text") {
  if (resourceKind === "text") {
    return "Create a dataset representing the raw text content as structured rows without applying business transformations."
  }
  return "Create a dataset representing the raw file content as structured rows without applying business transformations."
}

export function buildTransformInstructions(resourceCount: number, userInstructions?: string, schema?: DatasetSchemaInput) {
  const explicit = String(userInstructions ?? "").trim()
  if (explicit) return explicit
  if (resourceCount > 1) {
    if (schema) {
      return "Combine the input datasets into a new dataset that matches the provided output schema exactly."
    }
    return "Combine the input datasets into one coherent dataset."
  }
  if (schema) {
    return "Transform the input dataset into a new dataset that matches the provided output schema exactly."
  }
  return "Transform the input dataset into a new useful dataset."
}

export function buildObjectOutputInstructions(userInstructions?: string) {
  const base = String(userInstructions ?? "").trim()
  const objectContract = [
    "Output mode is object.",
    "Produce exactly one JSONL row in output.jsonl.",
    "That row must be {\"type\":\"row\",\"data\":<the final object>}.",
    "Do not emit multiple rows, headers, summaries, or metadata rows.",
  ].join("\n")

  if (!base) return objectContract
  return [base, "", objectContract].join("\n")
}

import type { DomainActionInputResolver } from "@ekairos/domain/internal"

import { datasetDomain } from "./schema.js"

const JSON_SCHEMA_ANNOTATIONS = new Set([
  "$comment",
  "$schema",
  "default",
  "deprecated",
  "description",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
])

const UNORDERED_JSON_SCHEMA_ARRAYS = new Set([
  "allOf",
  "anyOf",
  "enum",
  "oneOf",
  "required",
  "type",
])

type DatasetRow = Readonly<{
  datasetId?: unknown
  status?: unknown
  schema?: unknown
}>

export function createDatasetActionInputResolver(
  expectedItemSchema: unknown,
): DomainActionInputResolver {
  return async ({ actionId, path, runtime, value }) => {
    const datasetId = String((value as any)?.datasetId ?? "").trim()
    const activeDataset = await (runtime as any).use(datasetDomain)
    const result = await activeDataset.db.query({
      dataset_datasets: {
        $: {
          where: { datasetId },
          limit: 1,
        },
      },
    } as any)
    const stored = result?.dataset_datasets?.[0] as DatasetRow | undefined

    if (!stored) {
      throw new Error(
        `dataset_action_input_not_found:${actionId}:${path}:${datasetId}`,
      )
    }

    const status = String(stored.status ?? "")
    if (status !== "completed") {
      throw new Error(
        `dataset_action_input_not_completed:${actionId}:${path}:${datasetId}:${status || "unknown"}`,
      )
    }

    const storedItemSchema = readStoredItemSchema(stored.schema)
    if (storedItemSchema === undefined) {
      throw new Error(
        `dataset_action_input_schema_missing:${actionId}:${path}:${datasetId}`,
      )
    }

    if (!sameJsonSchema(storedItemSchema, expectedItemSchema)) {
      throw new Error(
        `dataset_action_input_schema_mismatch:${actionId}:${path}:${datasetId}`,
      )
    }
  }
}

function readStoredItemSchema(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  return (value as Record<string, unknown>).schema
}

function sameJsonSchema(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJsonSchema(left)) ===
    JSON.stringify(normalizeJsonSchema(right))
}

function normalizeJsonSchema(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeJsonSchema(entry))
    if (!parentKey || !UNORDERED_JSON_SCHEMA_ARRAYS.has(parentKey)) {
      return normalized
    }
    return normalized.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    )
  }

  if (!value || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !JSON_SCHEMA_ANNOTATIONS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizeJsonSchema(child, key)]),
  )
}

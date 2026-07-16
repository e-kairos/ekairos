import type { DatasetColumnType, DatasetRow, DatasetSchema } from "./types.js"

/** How many rows the inferencer samples. */
export const SCHEMA_SAMPLE_SIZE = 100

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * Pure schema inference over the first N rows.
 *
 * Rules:
 * - null/undefined values are ignored (they never define a type)
 * - Date instances and ISO-8601 strings → "date"
 * - a column whose sampled values disagree on type widens to "string"
 * - a column that is always null (or absent) defaults to "string"
 * - column order = first-seen order
 */
export function inferSchema(
  rows: DatasetRow[],
  sampleSize: number = SCHEMA_SAMPLE_SIZE,
): DatasetSchema {
  const seen = new Map<string, Set<DatasetColumnType>>()
  const order: string[] = []

  for (const row of rows.slice(0, sampleSize)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue
    for (const [name, value] of Object.entries(row)) {
      let types = seen.get(name)
      if (!types) {
        types = new Set()
        seen.set(name, types)
        order.push(name)
      }
      const type = inferValueType(value)
      if (type) types.add(type)
    }
  }

  return order.map((name) => {
    const types = seen.get(name)!
    if (types.size === 0) return { name, type: "string" as const }
    if (types.size === 1) return { name, type: [...types][0] }
    return { name, type: "string" as const }
  })
}

export function inferValueType(value: unknown): DatasetColumnType | null {
  if (value === null || typeof value === "undefined") return null
  if (Array.isArray(value)) return "array"
  if (value instanceof Date) return "date"
  if (typeof value === "number") return "number"
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "string") return ISO_DATE_RE.test(value) ? "date" : "string"
  if (typeof value === "object") return "object"
  return "string"
}

/**
 * PURE normalization of Neo4j records to flat rows — no driver import, fully
 * unit-testable. Mirrors the desktop graph-query.ts conversion, plus row
 * flattening (nodes → props, nested objects → dot-notation columns).
 */
import type { DatasetRow } from "../types.js"

/** duck-typed neo4j Record: enough to normalize without depending on the driver */
export type Neo4jRecordLike = {
  keys: ReadonlyArray<string | number | symbol>
  get(key: string | number | symbol): unknown
}

function isNeo4jInt(value: unknown): value is { toNumber(): number } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { toNumber?: unknown }).toNumber === "function" &&
      "low" in (value as object) &&
      "high" in (value as object),
  )
}

/** neo4j value → plain JSON: Integers → number, nodes/rels → props (+_labels/_type) */
export function neo4jValueToJson(value: unknown): unknown {
  if (value === null || typeof value === "undefined") return null
  if (isNeo4jInt(value)) return value.toNumber()
  if (Array.isArray(value)) return value.map(neo4jValueToJson)
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if ("properties" in record && typeof record.properties === "object" && record.properties !== null) {
      const props = neo4jValueToJson(record.properties) as Record<string, unknown>
      if (Array.isArray((record as { labels?: unknown }).labels)) {
        return { ...props, _labels: (record as { labels: string[] }).labels }
      }
      if (typeof (record as { type?: unknown }).type === "string") {
        return { ...props, _type: (record as { type: string }).type }
      }
      return props
    }
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(record)) {
      out[key] = neo4jValueToJson(entry)
    }
    return out
  }
  return value
}

/**
 * Flattens nested plain objects into dot-notation columns
 * ({ n: { name: "x" } } → { "n.name": "x" }). Arrays and primitives stay as-is.
 */
export function flattenRow(row: Record<string, unknown>, prefix = ""): DatasetRow {
  const out: DatasetRow = {}
  for (const [key, value] of Object.entries(row)) {
    const column = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenRow(value as Record<string, unknown>, column))
      continue
    }
    out[column] = value
  }
  return out
}

/**
 * Full normalization: neo4j records → flat plain rows.
 *
 * When a record has a SINGLE column that is an object (the common `RETURN n`
 * whole-node case), its properties are unwrapped to top-level columns —
 * `RETURN n` yields clean `{namespace, name, rating}`, not `{n.namespace, ...}`.
 * With multiple columns the variable prefix is kept to disambiguate
 * (`RETURN a, b` → `a.*`, `b.*`).
 */
export function normalizeNeo4jRecords(records: ReadonlyArray<Neo4jRecordLike>): DatasetRow[] {
  const keys = records[0] ? records[0].keys.map(String) : []
  const singleColumn = keys.length === 1 ? keys[0] : null

  return records.map((record) => {
    const raw: Record<string, unknown> = {}
    for (const key of record.keys) {
      raw[String(key)] = neo4jValueToJson(record.get(key))
    }
    // Unwrap a single object column to top-level (clean whole-node datasets).
    if (singleColumn) {
      const only = raw[singleColumn]
      if (only !== null && typeof only === "object" && !Array.isArray(only)) {
        return flattenRow(only as Record<string, unknown>)
      }
    }
    return flattenRow(raw)
  })
}

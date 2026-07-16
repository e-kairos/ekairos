/**
 * PURE SQL builders: (params) → { sql, params } with ClickHouse named bind
 * placeholders ({p0:String}, ...). No client, no I/O — unit-testable as-is.
 *
 * Typing decision (see DESIGN.md §1): rows live as a JSON string in a single
 * `advanced_dataset_rows` table (`data String`), so column pushdown uses the
 * ClickHouse JSON functions (JSONExtractString / JSONExtract(..., 'Float64') /
 * JSONExtractBool / JSONExtractRaw). Column NAMES cannot be bound as query
 * params, so every identifier goes through a strict safety guard; VALUES are
 * always bound, never inlined.
 */
import type {
  AggregateMetricFn,
  DatasetColumnType,
  DatasetSchema,
  DatasetSort,
  DatasetWhere,
  DatasetWhereCondition,
  WhereOperator,
} from "./types.js"

export type SqlQuery = {
  sql: string
  params: Record<string, unknown>
}

export const ADVANCED_DATASET_ROWS_TABLE = "advanced_dataset_rows"
export const DEFAULT_READ_LIMIT = 1_000
export const DEFAULT_EVENTS_LIMIT = 100_000

// ---------------------------------------------------------------------------
// identifier guards (SQL-injection surface: everything not bindable)
// ---------------------------------------------------------------------------

/** letters/digits/underscore/dot (dot = flattened neo4j columns like `n.name`), must start with letter or underscore */
const SAFE_COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/
const SAFE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const SAFE_PARTITION_RE = /^[A-Za-z0-9_-]{1,128}$/

export function assertSafeColumn(name: string): string {
  const value = String(name ?? "").trim()
  if (!SAFE_COLUMN_RE.test(value)) {
    throw new Error(`advanced_dataset_unsafe_column: ${JSON.stringify(name)}`)
  }
  return value
}

export function assertSafeIdent(name: string): string {
  const value = String(name ?? "").trim()
  if (!SAFE_IDENT_RE.test(value)) {
    throw new Error(`advanced_dataset_unsafe_identifier: ${JSON.stringify(name)}`)
  }
  return value
}

export function assertSafeDatasetId(datasetId: string): string {
  const value = String(datasetId ?? "").trim()
  if (!SAFE_PARTITION_RE.test(value)) {
    throw new Error(`advanced_dataset_unsafe_dataset_id: ${JSON.stringify(datasetId)}`)
  }
  return value
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit === "undefined") return fallback
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`advanced_dataset_invalid_limit: ${JSON.stringify(limit)}`)
  }
  return limit
}

function normalizeOffset(offset: number | undefined): number {
  if (typeof offset === "undefined") return 0
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`advanced_dataset_invalid_offset: ${JSON.stringify(offset)}`)
  }
  return offset
}

// ---------------------------------------------------------------------------
// JSON column extraction
// ---------------------------------------------------------------------------

function schemaType(column: string, schema?: DatasetSchema): DatasetColumnType | undefined {
  return schema?.find((c) => c.name === column)?.type
}

/** typed extraction expression for a JSON column */
export function jsonColumnExpr(column: string, type?: DatasetColumnType): string {
  const name = assertSafeColumn(column)
  switch (type) {
    case "number":
      return `JSONExtract(data, '${name}', 'Float64')`
    case "boolean":
      return `JSONExtractBool(data, '${name}')`
    default:
      // date/string/object/array/unknown: string extraction (ISO dates sort correctly)
      return `JSONExtractString(data, '${name}')`
  }
}

// ---------------------------------------------------------------------------
// where
// ---------------------------------------------------------------------------

const OP_SQL: Record<Exclude<WhereOperator, "in">, string> = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
}

function normalizeCondition(value: unknown): DatasetWhereCondition {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "op" in (value as Record<string, unknown>)
  ) {
    const condition = value as DatasetWhereCondition
    if (!(condition.op in OP_SQL) && condition.op !== "in") {
      throw new Error(`advanced_dataset_invalid_operator: ${JSON.stringify(condition.op)}`)
    }
    return condition
  }
  return { op: "eq", value }
}

function bindType(value: unknown): string {
  if (typeof value === "number") return "Float64"
  if (typeof value === "boolean") return "Bool"
  return "String"
}

function valueColumnType(value: unknown): DatasetColumnType | undefined {
  if (typeof value === "number") return "number"
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "string") return "string"
  return undefined
}

type WhereBuild = {
  /** " AND <cond> AND <cond>" or "" */
  clause: string
}

/**
 * Builds the AND-joined where clause. `lhs` maps a (guarded) column name to
 * its SQL expression — JSON extraction for dataset rows, plain column for
 * physical tables like ekairos_events.
 */
function buildWhereClause(
  where: DatasetWhere | undefined,
  params: Record<string, unknown>,
  lhs: (column: string, hint?: DatasetColumnType) => string,
  schema?: DatasetSchema,
): WhereBuild {
  if (!where) return { clause: "" }
  const parts: string[] = []
  for (const [column, raw] of Object.entries(where)) {
    const condition = normalizeCondition(raw)
    const key = `p${Object.keys(params).length}`
    if (condition.op === "in") {
      if (!Array.isArray(condition.value) || condition.value.length === 0) {
        throw new Error(`advanced_dataset_invalid_in_value: ${JSON.stringify(condition.value)}`)
      }
      const elementType = bindType(condition.value[0])
      const hint = schemaType(column, schema) ?? valueColumnType(condition.value[0])
      params[key] = condition.value
      parts.push(`${lhs(column, hint)} IN {${key}:Array(${elementType})}`)
      continue
    }
    const hint = schemaType(column, schema) ?? valueColumnType(condition.value)
    params[key] = condition.value
    parts.push(`${lhs(column, hint)} ${OP_SQL[condition.op]} {${key}:${bindType(condition.value)}}`)
  }
  if (parts.length === 0) return { clause: "" }
  return { clause: ` AND ${parts.join(" AND ")}` }
}

// ---------------------------------------------------------------------------
// sort
// ---------------------------------------------------------------------------

export function parseSort(
  sort: DatasetSort | undefined,
): Array<{ column: string; direction: "asc" | "desc" }> {
  if (!sort) return []
  const entries = typeof sort === "string" ? [sort] : sort
  return entries.map((entry) => {
    if (typeof entry === "string") {
      const [column, direction = "asc"] = entry.split(":")
      return validateSortEntry(column, direction)
    }
    return validateSortEntry(entry.column, entry.direction ?? "asc")
  })
}

function validateSortEntry(column: string, direction: string) {
  const safe = assertSafeColumn(column)
  const dir = String(direction).toLowerCase()
  if (dir !== "asc" && dir !== "desc") {
    throw new Error(`advanced_dataset_invalid_sort_direction: ${JSON.stringify(direction)}`)
  }
  return { column: safe, direction: dir as "asc" | "desc" }
}

// ---------------------------------------------------------------------------
// rows SELECT (readDatasetRows)
// ---------------------------------------------------------------------------

export type BuildRowsSqlInput = {
  database: string
  datasetId: string
  select?: string[]
  where?: DatasetWhere
  sort?: DatasetSort
  limit?: number
  offset?: number
  schema?: DatasetSchema
}

export function buildRowsSql(input: BuildRowsSqlInput): SqlQuery {
  const database = assertSafeIdent(input.database)
  const params: Record<string, unknown> = {
    datasetId: assertSafeDatasetId(input.datasetId),
  }

  const selectSql =
    input.select && input.select.length > 0
      ? input.select
          .map((column) => {
            const name = assertSafeColumn(column)
            return `JSONExtractRaw(data, '${name}') AS \`${name}\``
          })
          .join(", ")
      : "data"

  const jsonLhs = (column: string, hint?: DatasetColumnType) =>
    jsonColumnExpr(column, schemaType(column, input.schema) ?? hint)
  const { clause } = buildWhereClause(input.where, params, jsonLhs, input.schema)

  const sortEntries = parseSort(input.sort)
  const orderBy =
    sortEntries.length > 0
      ? `ORDER BY ${sortEntries
          .map((s) => `${jsonColumnExpr(s.column, schemaType(s.column, input.schema))} ${s.direction.toUpperCase()}`)
          .join(", ")}`
      : "ORDER BY row_idx ASC"

  const limit = normalizeLimit(input.limit, DEFAULT_READ_LIMIT)
  const offset = normalizeOffset(input.offset)

  const sql = [
    `SELECT ${selectSql}`,
    `FROM ${database}.${ADVANCED_DATASET_ROWS_TABLE}`,
    `WHERE dataset_id = {datasetId:String}${clause}`,
    orderBy,
    `LIMIT ${limit} OFFSET ${offset}`,
  ].join("\n")

  return { sql, params }
}

export type BuildRowsCountSqlInput = {
  database: string
  datasetId: string
  where?: DatasetWhere
  schema?: DatasetSchema
}

export function buildRowsCountSql(input: BuildRowsCountSqlInput): SqlQuery {
  const database = assertSafeIdent(input.database)
  const params: Record<string, unknown> = {
    datasetId: assertSafeDatasetId(input.datasetId),
  }
  const jsonLhs = (column: string, hint?: DatasetColumnType) =>
    jsonColumnExpr(column, schemaType(column, input.schema) ?? hint)
  const { clause } = buildWhereClause(input.where, params, jsonLhs, input.schema)
  const sql = [
    `SELECT count() AS row_count`,
    `FROM ${database}.${ADVANCED_DATASET_ROWS_TABLE}`,
    `WHERE dataset_id = {datasetId:String}${clause}`,
  ].join("\n")
  return { sql, params }
}

// ---------------------------------------------------------------------------
// aggregate (aggregateDataset)
// ---------------------------------------------------------------------------

const METRIC_RE = /^(count|sum|avg|min|max)\(\s*([A-Za-z_][A-Za-z0-9_.]*)?\s*\)$/

export function parseMetric(metric: string): { fn: AggregateMetricFn; column?: string } {
  const match = METRIC_RE.exec(String(metric ?? "").trim())
  if (!match) {
    throw new Error(`advanced_dataset_invalid_metric: ${JSON.stringify(metric)}`)
  }
  const fn = match[1] as AggregateMetricFn
  const column = match[2]
  if (fn === "count") {
    if (column) throw new Error(`advanced_dataset_invalid_metric: count() takes no column`)
    return { fn }
  }
  if (!column) {
    throw new Error(`advanced_dataset_invalid_metric: ${fn}() requires a column`)
  }
  return { fn, column: assertSafeColumn(column) }
}

export type BuildAggregateSqlInput = {
  database: string
  datasetId: string
  groupBy?: string
  metric: string
  where?: DatasetWhere
  schema?: DatasetSchema
}

export function buildAggregateSql(input: BuildAggregateSqlInput): SqlQuery {
  const database = assertSafeIdent(input.database)
  const params: Record<string, unknown> = {
    datasetId: assertSafeDatasetId(input.datasetId),
  }

  const { fn, column } = parseMetric(input.metric)
  let metricExpr: string
  if (fn === "count") {
    metricExpr = "count()"
  } else if (fn === "sum" || fn === "avg") {
    metricExpr = `${fn}(${jsonColumnExpr(column!, "number")})`
  } else {
    // min/max respect the schema type (string min/max is legitimate); default numeric
    metricExpr = `${fn}(${jsonColumnExpr(column!, schemaType(column!, input.schema) ?? "number")})`
  }

  const jsonLhs = (col: string, hint?: DatasetColumnType) =>
    jsonColumnExpr(col, schemaType(col, input.schema) ?? hint)
  const { clause } = buildWhereClause(input.where, params, jsonLhs, input.schema)

  const lines: string[] = []
  if (input.groupBy) {
    const groupExpr = jsonColumnExpr(input.groupBy, "string")
    lines.push(
      `SELECT ${groupExpr} AS group_key, ${metricExpr} AS value`,
      `FROM ${database}.${ADVANCED_DATASET_ROWS_TABLE}`,
      `WHERE dataset_id = {datasetId:String}${clause}`,
      `GROUP BY group_key`,
      `ORDER BY value DESC`,
    )
  } else {
    lines.push(
      `SELECT ${metricExpr} AS value`,
      `FROM ${database}.${ADVANCED_DATASET_ROWS_TABLE}`,
      `WHERE dataset_id = {datasetId:String}${clause}`,
    )
  }

  return { sql: lines.join("\n"), params }
}

// ---------------------------------------------------------------------------
// events source SELECT (physical columns on ekairos_events)
// ---------------------------------------------------------------------------

export const EKAIROS_EVENTS_TABLE = "ekairos_events"

export const EKAIROS_EVENTS_COLUMNS = [
  "app",
  "env",
  "namespace",
  "action",
  "entity_id",
  "before",
  "after",
  "idempotency_key",
  "event_at",
  "received_at",
] as const

const EVENTS_DATETIME_COLUMNS = new Set(["event_at", "received_at"])

export type BuildEventsSelectSqlInput = {
  database: string
  app: string
  env: string
  where?: DatasetWhere
  limit?: number
}

export function buildEventsSelectSql(input: BuildEventsSelectSqlInput): SqlQuery {
  const database = assertSafeIdent(input.database)
  const params: Record<string, unknown> = { app: input.app, env: input.env }

  const physicalLhs = (column: string) => {
    const name = assertSafeColumn(column)
    if (!(EKAIROS_EVENTS_COLUMNS as readonly string[]).includes(name)) {
      throw new Error(`advanced_dataset_unknown_events_column: ${JSON.stringify(column)}`)
    }
    return name
  }

  const parts: string[] = []
  let paramIdx = 0
  if (input.where) {
    for (const [column, raw] of Object.entries(input.where)) {
      const name = physicalLhs(column)
      const condition = normalizeCondition(raw)
      const key = `p${paramIdx++}`
      if (condition.op === "in") {
        if (!Array.isArray(condition.value) || condition.value.length === 0) {
          throw new Error(`advanced_dataset_invalid_in_value: ${JSON.stringify(condition.value)}`)
        }
        params[key] = condition.value
        parts.push(`${name} IN {${key}:Array(${bindType(condition.value[0])})}`)
        continue
      }
      params[key] = condition.value
      const rhs =
        EVENTS_DATETIME_COLUMNS.has(name) && typeof condition.value === "string"
          ? `parseDateTimeBestEffort({${key}:String})`
          : `{${key}:${bindType(condition.value)}}`
      parts.push(`${name} ${OP_SQL[condition.op]} ${rhs}`)
    }
  }
  const clause = parts.length > 0 ? ` AND ${parts.join(" AND ")}` : ""

  const limit = normalizeLimit(input.limit, DEFAULT_EVENTS_LIMIT)

  const sql = [
    `SELECT app, env, namespace, action, entity_id, before, after, idempotency_key, toString(event_at) AS event_at, toString(received_at) AS received_at`,
    `FROM ${database}.${EKAIROS_EVENTS_TABLE}`,
    `WHERE app = {app:String} AND env = {env:String}${clause}`,
    `ORDER BY event_at ASC`,
    `LIMIT ${limit}`,
  ].join("\n")

  return { sql, params }
}

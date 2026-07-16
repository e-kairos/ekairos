/**
 * Pure read API over materialized datasets — the functions the platform wraps
 * in HTTP in package 2 (`/dataset/:id/rows`, `/dataset/:id/aggregate`).
 *
 * All pushdown (column select, where, sort, limit/offset, group by, metrics)
 * executes IN ClickHouse via the pure builders in sql.ts; this module only
 * runs the queries and parses the JSON rows back.
 */
import type { ClickHouseClient } from "@clickhouse/client"

import { clickhouseDatabase } from "./clickhouse.js"
import { inferSchema } from "./schema.js"
import { buildAggregateSql, buildRowsCountSql, buildRowsSql } from "./sql.js"
import type {
  AggregateDatasetParams,
  AggregateDatasetResult,
  DatasetRow,
  ReadDatasetRowsParams,
  ReadDatasetRowsResult,
} from "./types.js"

export async function readDatasetRows(
  clickhouse: ClickHouseClient,
  params: ReadDatasetRowsParams,
): Promise<ReadDatasetRowsResult> {
  const database = params.database ?? clickhouseDatabase()
  const rowsQuery = buildRowsSql({ ...params, database })
  const countQuery = buildRowsCountSql({
    database,
    datasetId: params.datasetId,
    where: params.where,
    schema: params.schema,
  })

  const [rowsResult, countResult] = await Promise.all([
    clickhouse.query({ query: rowsQuery.sql, query_params: rowsQuery.params, format: "JSONEachRow" }),
    clickhouse.query({ query: countQuery.sql, query_params: countQuery.params, format: "JSONEachRow" }),
  ])

  const rawRows = (await rowsResult.json()) as Array<Record<string, unknown>>
  const rows =
    params.select && params.select.length > 0
      ? rawRows.map((row) => parseSelectedRow(row))
      : rawRows.map((row) => JSON.parse(String(row.data ?? "{}")) as DatasetRow)

  const countRows = (await countResult.json()) as Array<{ row_count: string | number }>
  const rowCount = Number(countRows[0]?.row_count ?? 0)

  return {
    rows,
    schema: params.schema ?? inferSchema(rows),
    rowCount,
  }
}

/** select pushdown returns JSONExtractRaw cells (raw JSON per column) — parse each */
function parseSelectedRow(row: Record<string, unknown>): DatasetRow {
  const out: DatasetRow = {}
  for (const [key, value] of Object.entries(row)) {
    const raw = String(value ?? "")
    if (raw === "") {
      out[key] = null
      continue
    }
    try {
      out[key] = JSON.parse(raw)
    } catch {
      out[key] = raw
    }
  }
  return out
}

export async function aggregateDataset(
  clickhouse: ClickHouseClient,
  params: AggregateDatasetParams,
): Promise<AggregateDatasetResult> {
  const database = params.database ?? clickhouseDatabase()
  const { sql, params: queryParams } = buildAggregateSql({ ...params, database })
  const result = await clickhouse.query({
    query: sql,
    query_params: queryParams,
    format: "JSONEachRow",
  })
  const raw = (await result.json()) as Array<{ group_key?: string; value: string | number }>
  return {
    rows: raw.map((row) => ({
      group: params.groupBy ? String(row.group_key ?? "") : null,
      value: Number(row.value),
    })),
  }
}

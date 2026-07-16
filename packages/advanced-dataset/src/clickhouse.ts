/**
 * ClickHouse client + sink for advanced datasets.
 *
 * Envs (same names/defaults as the ekairos-data docker-compose local stack and
 * the ingest projector's clickhouse-sink in ekairos-core):
 * - CLICKHOUSE_URL        default http://localhost:8123
 * - CLICKHOUSE_USER       (or CLICKHOUSE_USERNAME), default "default"
 * - CLICKHOUSE_PASSWORD   default "ekairos-clickhouse" (local compose)
 * - CLICKHOUSE_DATABASE   optional, default "default"
 * - CLICKHOUSE_TIMEOUT_MS optional, default 10000 — nothing here waits forever
 *
 * Typing decision (DESIGN.md §1, start-simple option): a SINGLE table
 * partitioned by dataset_id, rows stored as `data String` (the row's JSON).
 * The inferred schema is metadata (returned by build(), registered by the
 * platform in package 2) — NOT physical columns. This keeps the sink schema-
 * free per dataset, and deletion is a cheap DROP PARTITION. Column pushdown
 * happens with ClickHouse JSON functions (see sql.ts).
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client"

import { ADVANCED_DATASET_ROWS_TABLE, assertSafeDatasetId } from "./sql.js"
import type { DatasetRow } from "./types.js"

export const ADVANCED_DATASET_ROWS_DDL = (database: string) => `
CREATE TABLE IF NOT EXISTS ${database}.${ADVANCED_DATASET_ROWS_TABLE} (
  dataset_id LowCardinality(String),
  row_idx UInt32,
  data String,
  created_at DateTime64(3, 'UTC') DEFAULT now64(3),
  pinned UInt8 DEFAULT 0
) ENGINE = MergeTree
PARTITION BY dataset_id
ORDER BY (dataset_id, row_idx)
`

let client: ClickHouseClient | null = null
let tableReady = false

export function clickhouseDatabase(): string {
  return process.env.CLICKHOUSE_DATABASE?.trim() || "default"
}

export function getClickhouseClient(): ClickHouseClient {
  if (client) return client
  const url = process.env.CLICKHOUSE_URL?.trim() || "http://localhost:8123"
  const timeoutMs = Number(process.env.CLICKHOUSE_TIMEOUT_MS ?? 10_000)
  client = createClient({
    url,
    username:
      process.env.CLICKHOUSE_USER?.trim() ||
      process.env.CLICKHOUSE_USERNAME?.trim() ||
      "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "ekairos-clickhouse",
    request_timeout: Number.isFinite(timeoutMs) ? timeoutMs : 10_000,
    clickhouse_settings: {
      date_time_input_format: "best_effort",
    },
  })
  return client
}

/** idempotent auto-create — cached per process */
export async function ensureDatasetRowsTable(
  ch: ClickHouseClient,
  database: string = clickhouseDatabase(),
): Promise<void> {
  if (tableReady) return
  await ch.command({ query: ADVANCED_DATASET_ROWS_DDL(database) })
  tableReady = true
}

export type InsertDatasetRowsParams = {
  datasetId: string
  rows: DatasetRow[]
  database?: string
}

/** Materializes rows: { dataset_id, row_idx, data: JSON(row) } into the partitioned table. */
export async function insertDatasetRows(
  ch: ClickHouseClient,
  params: InsertDatasetRowsParams,
): Promise<number> {
  const datasetId = assertSafeDatasetId(params.datasetId)
  const database = params.database ?? clickhouseDatabase()
  await ensureDatasetRowsTable(ch, database)
  if (params.rows.length === 0) return 0
  await ch.insert({
    table: `${database}.${ADVANCED_DATASET_ROWS_TABLE}`,
    format: "JSONEachRow",
    values: params.rows.map((row, idx) => ({
      dataset_id: datasetId,
      row_idx: idx,
      data: JSON.stringify(row ?? {}),
    })),
  })
  return params.rows.length
}

/** Drops all rows of a dataset — cheap: the table is partitioned by dataset_id. */
export async function dropDatasetRows(
  ch: ClickHouseClient,
  params: { datasetId: string; database?: string },
): Promise<void> {
  const datasetId = assertSafeDatasetId(params.datasetId)
  const database = params.database ?? clickhouseDatabase()
  await ensureDatasetRowsTable(ch, database)
  await ch.command({
    query: `ALTER TABLE ${database}.${ADVANCED_DATASET_ROWS_TABLE} DROP PARTITION '${datasetId}'`,
  })
}

export async function closeClickhouseClient(): Promise<void> {
  if (client) {
    await client.close()
    client = null
    tableReady = false
  }
}

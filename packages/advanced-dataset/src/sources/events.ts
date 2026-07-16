/**
 * `kind: "events"` source — SELECT from the `ekairos_events` ClickHouse
 * replica (the table the ingest projector's clickhouse-sink auto-creates).
 * Scoped by { app, env }; optional `where` on the physical event columns.
 *
 * `before`/`after` come back as raw JSON strings (faithful to the replica) —
 * unpacking them into columns is planner territory (package 3).
 */
import type { ClickHouseClient } from "@clickhouse/client"

import { clickhouseDatabase } from "../clickhouse.js"
import { buildEventsSelectSql } from "../sql.js"
import type { DatasetRow, EventsSource } from "../types.js"

export async function runEventsSource(
  ch: ClickHouseClient,
  source: EventsSource,
  database: string = clickhouseDatabase(),
): Promise<DatasetRow[]> {
  const app = String(source.app ?? "").trim()
  const env = String(source.env ?? "").trim()
  if (!app || !env) {
    throw new Error("advanced_dataset_events_scope_required: app and env are mandatory")
  }
  const { sql, params } = buildEventsSelectSql({
    database,
    app,
    env,
    where: source.where,
    limit: source.limit,
  })
  const result = await ch.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
  })
  return (await result.json()) as DatasetRow[]
}

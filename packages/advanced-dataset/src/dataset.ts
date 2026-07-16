/**
 * `dataset(runtime, { store: "clickhouse" })` — same builder shape as
 * `@ekairos/dataset` (`.from({kind,...}).asRows().build()`), different store:
 * rows materialize into ClickHouse (single `advanced_dataset_rows` table
 * partitioned by dataset_id; see clickhouse.ts for the typing decision).
 */
import { clickhouseDatabase, getClickhouseClient, insertDatasetRows } from "./clickhouse.js"
import { createDatasetId } from "./id.js"
import { inferSchema } from "./schema.js"
import { runCypherSource } from "./sources/cypher.js"
import { runEventsSource } from "./sources/events.js"
import type {
  AdvancedDatasetBuilder,
  AdvancedDatasetBuilderOptions,
  AdvancedDatasetBuildResult,
  AdvancedDatasetRuntime,
  AdvancedDatasetSource,
  DatasetRow,
} from "./types.js"

export const DATASET_PREVIEW_SIZE = 5

export function dataset(
  _runtime: AdvancedDatasetRuntime,
  options: AdvancedDatasetBuilderOptions,
): AdvancedDatasetBuilder {
  if (options?.store !== "clickhouse") {
    throw new Error(
      `advanced_dataset_store_unsupported: ${JSON.stringify(options?.store)} (only "clickhouse")`,
    )
  }
  const datasetId = normalizeDatasetId(options.datasetId)
  let source: AdvancedDatasetSource | null = null

  const api: AdvancedDatasetBuilder = {
    datasetId,

    from(input: AdvancedDatasetSource) {
      if (source) {
        throw new Error("advanced_dataset_single_source: analytic datasets take exactly one source")
      }
      if (!input || typeof input !== "object" || !("kind" in input)) {
        throw new Error("advanced_dataset_source_kind_required")
      }
      source = input
      return api
    },

    asRows() {
      // rows is the only output of the analytic store — kept for API parity
      return api
    },

    async build(): Promise<AdvancedDatasetBuildResult> {
      if (!source) {
        throw new Error("advanced_dataset_source_required")
      }
      const rows = await resolveSourceRows(source, options)
      const schema = inferSchema(rows)
      const clickhouse = options.clickhouse ?? getClickhouseClient()
      const database = options.database ?? clickhouseDatabase()
      await insertDatasetRows(clickhouse, { datasetId, rows, database })
      return {
        datasetId,
        schema,
        rowCount: rows.length,
        preview: rows.slice(0, DATASET_PREVIEW_SIZE),
      }
    },
  }

  return api
}

async function resolveSourceRows(
  source: AdvancedDatasetSource,
  options: AdvancedDatasetBuilderOptions,
): Promise<DatasetRow[]> {
  switch (source.kind) {
    case "cypher":
      return runCypherSource(source, { driver: options.neo4j })
    case "events":
      return runEventsSource(
        options.clickhouse ?? getClickhouseClient(),
        source,
        options.database ?? clickhouseDatabase(),
      )
    case "instaql":
      // TODO(advanced-dataset/planner): live domain source (InstaQL) needs
      // domain/run — it lands with the platform query planner (package 3).
      throw new Error(
        "advanced_dataset_instaql_not_implemented: live domain source llega con el planner del platform",
      )
    default:
      throw new Error(
        `advanced_dataset_source_unsupported: ${JSON.stringify((source as { kind?: unknown }).kind)}`,
      )
  }
}

function normalizeDatasetId(datasetId?: string): string {
  const normalized = String(datasetId ?? createDatasetId()).trim()
  if (!normalized) {
    throw new Error("dataset_id_required")
  }
  return normalized
}

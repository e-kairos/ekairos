import type { ClickHouseClient } from "@clickhouse/client"
import type { Driver } from "neo4j-driver"

/** Column types the schema inferencer emits (metadata only — rows are stored as JSON). */
export type DatasetColumnType = "string" | "number" | "boolean" | "date" | "object" | "array"

export type DatasetSchemaColumn = { name: string; type: DatasetColumnType }
export type DatasetSchema = DatasetSchemaColumn[]

export type DatasetRow = Record<string, unknown>

/**
 * Minimal runtime contract, mirroring what `@ekairos/dataset` receives.
 * The clickhouse store resolves its own connections from env (or from the
 * injectable options below), so nothing on the runtime is required today —
 * the parameter keeps the call signature identical to `dataset(runtime, opts)`.
 */
export type AdvancedDatasetRuntime = {
  env?: Record<string, unknown>
  db?: () => Promise<unknown>
} & Record<string, unknown>

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * READ-ONLY Cypher against the replicated business graph (Neo4j).
 * `params.app` / `params.env` are mandatory tenant scoping — every projected
 * node carries `app`/`env` props, queries filter with $app / $env.
 */
export type CypherSource = {
  kind: "cypher"
  query: string
  params: { app: string; env: string } & Record<string, unknown>
}

/** SELECT from the `ekairos_events` ClickHouse replica (created by the ingest projector). */
export type EventsSource = {
  kind: "events"
  app: string
  env: string
  where?: DatasetWhere
  limit?: number
}

/**
 * Live domain source (InstaQL). Declared in the type but NOT implemented here:
 * it needs `domain/run` and the platform planner — territory of package 3.
 * TODO(advanced-dataset/planner): implement when the platform query planner lands.
 */
export type InstaqlSource = {
  kind: "instaql"
  query?: unknown
  params?: Record<string, unknown>
}

export type AdvancedDatasetSource = CypherSource | EventsSource | InstaqlSource

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export type AdvancedDatasetStore = "clickhouse"

export type AdvancedDatasetBuilderOptions = {
  store: AdvancedDatasetStore
  datasetId?: string
  /** injectable clients (tests / platform reuse); defaults resolve from env */
  clickhouse?: ClickHouseClient
  neo4j?: Driver
  database?: string
}

export type AdvancedDatasetBuildResult = {
  datasetId: string
  schema: DatasetSchema
  rowCount: number
  preview: DatasetRow[]
}

export type AdvancedDatasetBuilder = {
  datasetId: string
  from(source: AdvancedDatasetSource): AdvancedDatasetBuilder
  asRows(): AdvancedDatasetBuilder
  build(): Promise<AdvancedDatasetBuildResult>
}

// ---------------------------------------------------------------------------
// Read API (pure SQL builders + thin executors; the platform wraps these in HTTP)
// ---------------------------------------------------------------------------

export type WhereOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "in"

export type DatasetWhereCondition = { op: WhereOperator; value: unknown }

/** `{ col: value }` (equality) or `{ col: { op, value } }` */
export type DatasetWhere = Record<
  string,
  string | number | boolean | DatasetWhereCondition
>

/** `"col"` | `"col:desc"` | explicit array form */
export type DatasetSort =
  | string
  | Array<{ column: string; direction?: "asc" | "desc" }>

export type ReadDatasetRowsParams = {
  datasetId: string
  select?: string[]
  where?: DatasetWhere
  sort?: DatasetSort
  limit?: number
  offset?: number
  /**
   * Optional type hints ([{name,type}] from the dataset metadata). With hints,
   * where/sort push down with typed JSON extraction (numeric sort, numeric
   * comparisons). Without hints, types are derived from the filter values and
   * sort falls back to string extraction.
   */
  schema?: DatasetSchema
  database?: string
}

export type ReadDatasetRowsResult = {
  rows: DatasetRow[]
  schema: DatasetSchema
  rowCount: number
}

export type AggregateMetricFn = "count" | "sum" | "avg" | "min" | "max"

export type AggregateDatasetParams = {
  datasetId: string
  groupBy?: string
  /** `count()` | `sum(col)` | `avg(col)` | `min(col)` | `max(col)` */
  metric: string
  where?: DatasetWhere
  schema?: DatasetSchema
  database?: string
}

export type AggregateDatasetResult = {
  rows: Array<{ group: string | null; value: number }>
}

export const REMOTE_DATASET_MAX_INLINE_ROWS = 10_000

export type RemoteDatasetScope = Readonly<{
  app: string
  env: string
}>

export type RemoteDatasetSchemaColumn = Readonly<{
  name: string
  type: string
}>

export type RemoteDatasetRow = Record<string, unknown>

export type RemoteDatasetMaterializeInput = RemoteDatasetScope & Readonly<{
  name?: string
  source: Readonly<{
    kind: "rows"
    rows: readonly unknown[]
    origin?: string
  }>
}>

export type RemoteDatasetMaterializeResult = Readonly<{
  datasetId: string
  name: string
  schema: RemoteDatasetSchemaColumn[]
  preview: RemoteDatasetRow[]
  rowCount: number
}>

export type RemoteDatasetRowsInput = Readonly<{
  datasetId: string
  select?: readonly string[]
  where?: Readonly<Record<string, unknown>>
  sort?: string
  limit?: number
  offset?: number
}>

export type RemoteDatasetRowsResult = Readonly<{
  rows: RemoteDatasetRow[]
  schema: RemoteDatasetSchemaColumn[]
  rowCount: number
}>

export type RemoteDatasetAggregateInput = Readonly<{
  datasetId: string
  groupBy?: string
  metric: string
  where?: Readonly<Record<string, unknown>>
}>

export type RemoteDatasetAggregateResult = Readonly<{
  rows: Array<{ group: string | null; value: number }>
}>

export type RemoteDatasetStore = Readonly<{
  materialize(input: RemoteDatasetMaterializeInput): Promise<RemoteDatasetMaterializeResult>
  rows(input: RemoteDatasetRowsInput): Promise<RemoteDatasetRowsResult>
  aggregate(input: RemoteDatasetAggregateInput): Promise<RemoteDatasetAggregateResult>
}>

export type RemoteDatasetStoreConfig = Readonly<{
  /** Full collection endpoint, for example https://platform.example/api/platform/dataset. */
  endpoint: string
  token: string
  organizationId?: string
}>

export class RemoteDatasetStoreError extends Error {
  readonly operation: "materialize" | "rows" | "aggregate"
  readonly status: number
  readonly body: unknown

  constructor(params: {
    operation: "materialize" | "rows" | "aggregate"
    status: number
    body: unknown
    error: string
  }) {
    super(`remote_dataset_${params.operation}_failed_${params.status}:${params.error}`)
    this.name = "RemoteDatasetStoreError"
    this.operation = params.operation
    this.status = params.status
    this.body = params.body
  }
}

export function remoteDatasetStore(
  config: RemoteDatasetStoreConfig,
): RemoteDatasetStore {
  const endpoint = requiredText(config.endpoint, "remote_dataset_endpoint_required")
    .replace(/\/+$/, "")
  const token = requiredText(config.token, "remote_dataset_token_required")
  const organizationId = optionalText(config.organizationId)

  const request = async <T>(input: {
    operation: "materialize" | "rows" | "aggregate"
    url: string
    method?: "GET" | "POST"
    body?: unknown
  }): Promise<T> => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    }
    if (organizationId) {
      headers["x-ekairos-organization-id"] = organizationId
    }
    if (input.body !== undefined) {
      headers["Content-Type"] = "application/json"
    }

    const response = await fetch(input.url, {
      method: input.method ?? "GET",
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
    const body = await readResponseBody(response)
    if (!response.ok || !isOkPayload(body)) {
      throw new RemoteDatasetStoreError({
        operation: input.operation,
        status: response.status,
        body,
        error: payloadError(body),
      })
    }
    return body as T
  }

  return Object.freeze({
    async materialize(input) {
      const app = requiredText(input.app, "remote_dataset_app_required")
      const env = requiredText(input.env, "remote_dataset_env_required")
      const rows = validateInlineRows(input.source.rows)
      const result = await request<Record<string, unknown>>({
        operation: "materialize",
        url: endpoint,
        method: "POST",
        body: {
          app,
          env,
          ...(optionalText(input.name) ? { name: optionalText(input.name) } : {}),
          source: {
            kind: "rows",
            rows,
            ...(optionalText(input.source.origin)
              ? { origin: optionalText(input.source.origin) }
              : {}),
          },
        },
      })
      const datasetId = requiredText(
        result.datasetId,
        "remote_dataset_materialize_response_dataset_id_required",
      )
      return {
        datasetId,
        name: String(result.name ?? ""),
        schema: arrayOrEmpty<RemoteDatasetSchemaColumn>(result.schema),
        preview: arrayOrEmpty<RemoteDatasetRow>(result.preview),
        rowCount: numberOrZero(result.rowCount),
      }
    },

    async rows(input) {
      const datasetId = requiredText(input.datasetId, "remote_dataset_id_required")
      const search = new URLSearchParams()
      if (input.select && input.select.length > 0) {
        search.set("select", input.select.join(","))
      }
      if (input.where && Object.keys(input.where).length > 0) {
        search.set("where", JSON.stringify(input.where))
      }
      if (optionalText(input.sort)) search.set("sort", optionalText(input.sort))
      if (input.limit !== undefined) search.set("limit", String(input.limit))
      if (input.offset !== undefined) search.set("offset", String(input.offset))
      const query = search.toString()
      const result = await request<Record<string, unknown>>({
        operation: "rows",
        url: `${endpoint}/${encodeURIComponent(datasetId)}/rows${query ? `?${query}` : ""}`,
      })
      return {
        rows: arrayOrEmpty<RemoteDatasetRow>(result.rows),
        schema: arrayOrEmpty<RemoteDatasetSchemaColumn>(result.schema),
        rowCount: numberOrZero(result.rowCount),
      }
    },

    async aggregate(input) {
      const datasetId = requiredText(input.datasetId, "remote_dataset_id_required")
      const metric = requiredText(input.metric, "remote_dataset_metric_required")
      const search = new URLSearchParams({ metric })
      if (optionalText(input.groupBy)) {
        search.set("groupBy", optionalText(input.groupBy))
      }
      if (input.where && Object.keys(input.where).length > 0) {
        search.set("where", JSON.stringify(input.where))
      }
      const result = await request<Record<string, unknown>>({
        operation: "aggregate",
        url: `${endpoint}/${encodeURIComponent(datasetId)}/aggregate?${search.toString()}`,
      })
      return {
        rows: arrayOrEmpty<{ group: string | null; value: number }>(result.rows),
      }
    },
  })
}

function validateInlineRows(rows: readonly unknown[]): RemoteDatasetRow[] {
  if (!Array.isArray(rows)) {
    throw new Error("remote_dataset_inline_rows_array_required")
  }
  if (rows.length > REMOTE_DATASET_MAX_INLINE_ROWS) {
    throw new Error(
      `remote_dataset_inline_rows_limit_exceeded:${rows.length}>${REMOTE_DATASET_MAX_INLINE_ROWS}`,
    )
  }
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`remote_dataset_inline_row_invalid:${index}`)
    }
    return row as RemoteDatasetRow
  })
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function isOkPayload(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { ok?: unknown }).ok === true)
}

function payloadError(value: unknown): string {
  if (value && typeof value === "object") {
    return String((value as { error?: unknown }).error ?? "request_failed")
  }
  return "request_failed"
}

function requiredText(value: unknown, error: string): string {
  const text = optionalText(value)
  if (!text) throw new Error(error)
  return text
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

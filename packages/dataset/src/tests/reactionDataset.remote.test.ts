import { beforeEach, describe, expect, it, vi } from "vitest"

import type { RemoteDatasetStore } from "../remoteDatasetStore.js"
import { RemoteDatasetStoreError } from "../remoteDatasetStore.js"

const mock = vi.hoisted(() => {
  const finalReader = {
    read: vi.fn(async () => ({
      rows: [{ sku: "FINAL" }],
      cursor: 1,
      done: true,
    })),
  }
  const builtResult = {
    datasetId: "instant_staging",
    dataset: { calculatedTotalRows: 1 },
    notation: null,
    previewRows: [{ sku: "STAGING" }],
    reader: finalReader,
  }
  const builder: Record<string, any> = {}
  for (const method of [
    "sandbox",
    "title",
    "from",
    "fromText",
    "fromQuery",
    "engine",
    "instructions",
    "schema",
    "auto",
    "asRows",
    "asObject",
  ]) builder[method] = vi.fn(() => builder)
  builder.build = vi.fn(async () => builtResult)

  return {
    builder,
    builtResult,
    finalReader,
    materializeDataset: vi.fn(() => builder),
    finalizeBuildResult: vi.fn(),
  }
})

vi.mock("../dataset.js", () => ({
  materializeDataset: mock.materializeDataset,
}))
vi.mock("../builder/persistence.js", () => ({
  finalizeBuildResult: mock.finalizeBuildResult,
}))

import {
  buildReactionDataset,
  remoteDatasetOptionsFromEnv,
} from "../reactionDataset.js"

function createInput(spec: any, queryResult?: unknown) {
  const query = vi.fn(async () => queryResult)
  return {
    runtime: {
      env: { orgId: "org_1" },
      db: vi.fn(async () => ({ query })),
    } as any,
    sandboxId: "sandbox_1",
    sessionId: "session_1",
    reactionId: "reaction_1",
    contextId: "context_1",
    context: {
      ref: { id: "context_1", key: "context:key" },
      content: {},
      previous: undefined,
    },
    trigger: { id: "trigger_1" } as any,
    engine: { kind: "dataset-engine" } as any,
    spec,
    query,
  }
}

function createStore(): RemoteDatasetStore & {
  materialize: ReturnType<typeof vi.fn>
  rows: ReturnType<typeof vi.fn>
  aggregate: ReturnType<typeof vi.fn>
} {
  return {
    materialize: vi.fn(async () => ({
      datasetId: "remote_generated",
      name: "Remote",
      schema: [{ name: "sku", type: "string" }],
      preview: [{ sku: "PREVIEW" }],
      rowCount: 1,
    })),
    rows: vi.fn(),
    aggregate: vi.fn(),
  }
}

function notFound() {
  return new RemoteDatasetStoreError({
    operation: "rows",
    status: 404,
    body: { ok: false, error: "dataset_not_found" },
    error: "dataset_not_found",
  })
}

describe("buildReactionDataset remote store", () => {
  beforeEach(() => {
    mock.materializeDataset.mockClear()
    mock.finalizeBuildResult.mockReset()
    mock.finalReader.read.mockClear()
    mock.finalReader.read.mockResolvedValue({
      rows: [{ sku: "FINAL" }],
      cursor: 1,
      done: true,
    })
    for (const value of Object.values(mock.builder)) {
      if (typeof value?.mockClear === "function") value.mockClear()
    }
    mock.builder.build.mockResolvedValue(mock.builtResult)
  })

  it("uploads a direct row source without creating Instant staging", async () => {
    const store = createStore()
    store.rows.mockRejectedValueOnce(notFound())
    const input = createInput({
      datasetId: "deterministic_local_id",
      ensure: {
        title: "Products",
        source: { rows: [{ sku: "A-1" }] },
      },
    })

    const result = await buildReactionDataset(input as any, {
      store,
      scope: { app: "app_1", env: "preview" },
    })

    expect(store.materialize).toHaveBeenCalledWith({
      app: "app_1",
      env: "preview",
      name: "Products",
      source: {
        kind: "rows",
        rows: [{ sku: "A-1" }],
        origin: "@ekairos/dataset",
      },
    })
    expect(mock.materializeDataset).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      datasetId: "remote_generated",
      mode: "built",
      previewRows: [{ sku: "PREVIEW" }],
      count: 1,
    })
  })

  it("executes InstaQL with the runtime and uploads normalized rows", async () => {
    const store = createStore()
    store.rows.mockRejectedValueOnce(notFound())
    const query = { products: { $: { fields: ["sku"] } } }
    const input = createInput({
      datasetId: "query_local_id",
      ensure: {
        source: {
          query,
          domain: { meta: { name: "catalog" } },
        },
      },
    }, {
      products: [{ id: "product_1", sku: "A-1" }],
    })

    await buildReactionDataset(input as any, {
      store,
      scope: { app: "app_1", env: "production" },
    })

    expect(input.query).toHaveBeenCalledWith(query)
    expect(store.materialize).toHaveBeenCalledWith({
      app: "app_1",
      env: "production",
      source: {
        kind: "rows",
        rows: [{ id: "product_1", sku: "A-1" }],
        origin: "@ekairos/dataset",
      },
    })
    expect(mock.materializeDataset).not.toHaveBeenCalled()
  })

  it("uploads the final local transform while Instant remains staging", async () => {
    const store = createStore()
    store.rows.mockRejectedValueOnce(notFound())
    mock.finalizeBuildResult.mockRejectedValueOnce(new Error("instant_not_found"))
    const input = createInput({
      datasetId: "transform_local_id",
      ensure: {
        source: { rows: [{ sku: "RAW" }] },
        instructions: "Normalize the SKU.",
      },
    })

    const result = await buildReactionDataset(input as any, {
      store,
      scope: { app: "app_1", env: "development" },
    })

    expect(mock.materializeDataset).toHaveBeenCalled()
    expect(mock.builder.build).toHaveBeenCalledWith({
      datasetId: "transform_local_id",
    })
    expect(store.materialize).toHaveBeenCalledWith({
      app: "app_1",
      env: "development",
      source: {
        kind: "rows",
        rows: [{ sku: "FINAL" }],
        origin: "@ekairos/dataset",
      },
    })
    expect(result.datasetId).toBe("remote_generated")
  })

  it("materializes prior remote datasets as local transform sources", async () => {
    const store = createStore()
    store.rows
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce({
        rows: [{ sku: "SOURCE" }],
        schema: [{ name: "sku", type: "string" }],
        rowCount: 1,
      })
    mock.finalizeBuildResult.mockRejectedValueOnce(new Error("instant_not_found"))
    const input = createInput({
      datasetId: "transform_local_id",
      ensure: {
        source: {
          datasets: [{ datasetId: "remote_source", description: "Source rows" }],
        },
        instructions: "Normalize the rows.",
      },
    })

    await buildReactionDataset(input as any, {
      store,
      scope: { app: "app_1", env: "development" },
    })

    expect(store.rows).toHaveBeenNthCalledWith(2, {
      datasetId: "remote_source",
      offset: 0,
      limit: 10_000,
    })
    expect(mock.builder.fromText).toHaveBeenCalledWith({
      text: "{\"type\":\"row\",\"data\":{\"sku\":\"SOURCE\"}}\n",
      mimeType: "application/x-ndjson",
      name: "remote_source.jsonl",
      description: "Source rows",
    })
  })

  it("fails a local transform over 10,000 final rows without uploading", async () => {
    const store = createStore()
    store.rows.mockRejectedValueOnce(notFound())
    mock.finalizeBuildResult.mockRejectedValueOnce(new Error("instant_not_found"))
    mock.finalReader.read.mockResolvedValueOnce({
      rows: Array.from({ length: 10_001 }, (_, index) => ({ index })),
      cursor: 10_001,
      done: true,
    })
    const input = createInput({
      datasetId: "large_transform_local_id",
      ensure: {
        source: { rows: [{ sku: "RAW" }] },
        instructions: "Expand the rows.",
      },
    })

    await expect(buildReactionDataset(input as any, {
      store,
      scope: { app: "app_1", env: "development" },
    })).rejects.toThrow(
      "remote_dataset_inline_rows_limit_exceeded:10001>10000",
    )
    expect(store.materialize).not.toHaveBeenCalled()
  })

  it("opens a platform-generated dataset id without rebuilding", async () => {
    const store = createStore()
    store.rows.mockResolvedValueOnce({
      rows: [{ sku: "OPENED" }],
      schema: [{ name: "sku", type: "string" }],
      rowCount: 3,
    })
    const input = createInput({
      datasetId: "remote_existing",
      open: true,
    })

    const result = await buildReactionDataset(input as any, {
      store,
      scope: { app: "app_1", env: "development" },
    })

    expect(store.rows).toHaveBeenCalledWith({
      datasetId: "remote_existing",
      offset: 0,
      limit: 20,
    })
    expect(store.materialize).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      datasetId: "remote_existing",
      mode: "opened",
      previewRows: [{ sku: "OPENED" }],
      count: 3,
    })
  })

  it("resolves complete env configuration and keeps an empty env on Instant", () => {
    expect(remoteDatasetOptionsFromEnv({})).toBeUndefined()

    const options = remoteDatasetOptionsFromEnv({
      EKAIROS_DATASET_ENDPOINT: " https://platform.example/api/platform/dataset ",
      EKAIROS_DATASET_TOKEN: " token_123 ",
      EKAIROS_DATASET_APP: " app_123 ",
      EKAIROS_DATASET_ENV: " preview ",
      EKAIROS_DATASET_ORGANIZATION_ID: " org_123 ",
    })

    expect(options?.scope).toEqual({ app: "app_123", env: "preview" })
    expect(options?.store).toMatchObject({
      materialize: expect.any(Function),
      rows: expect.any(Function),
      aggregate: expect.any(Function),
    })
    expect(() => remoteDatasetOptionsFromEnv({
      EKAIROS_DATASET_ENDPOINT: "https://platform.example/api/platform/dataset",
    })).toThrow("remote_dataset_env_incomplete:token,app,env")
  })
})

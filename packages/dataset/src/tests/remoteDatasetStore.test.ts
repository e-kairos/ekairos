import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  REMOTE_DATASET_MAX_INLINE_ROWS,
  RemoteDatasetStoreError,
  remoteDatasetStore,
} from "../remoteDatasetStore.js"

describe("remoteDatasetStore", () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it("materializes inline rows against the exact platform contract", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      datasetId: "ds_generated",
      name: "Offers",
      schema: [{ name: "amount", type: "number" }],
      preview: [{ amount: 10 }],
      rowCount: 1,
    }))
    const store = remoteDatasetStore({
      endpoint: "https://platform.example/api/platform/dataset/",
      token: "token_123",
      organizationId: "org_123",
    })

    await expect(store.materialize({
      app: "app_123",
      env: "development",
      name: "Offers",
      source: {
        kind: "rows",
        rows: [{ amount: 10 }],
        origin: "@ekairos/dataset",
      },
    })).resolves.toEqual({
      datasetId: "ds_generated",
      name: "Offers",
      schema: [{ name: "amount", type: "number" }],
      preview: [{ amount: 10 }],
      rowCount: 1,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://platform.example/api/platform/dataset",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer token_123",
          "Content-Type": "application/json",
          "x-ekairos-organization-id": "org_123",
        },
        body: JSON.stringify({
          app: "app_123",
          env: "development",
          name: "Offers",
          source: {
            kind: "rows",
            rows: [{ amount: 10 }],
            origin: "@ekairos/dataset",
          },
        }),
      },
    )
  })

  it("maps row projection, filter, sort, limit, and offset to query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      rows: [{ supplier: "Acme" }],
      schema: [{ name: "supplier", type: "string" }],
      rowCount: 3,
    }))
    const store = remoteDatasetStore({
      endpoint: "https://platform.example/api/platform/dataset",
      token: "token_123",
    })

    await expect(store.rows({
      datasetId: "ds/with space",
      select: ["supplier", "amount"],
      where: { status: "open", amount: { op: "gte", value: 10 } },
      sort: "amount:desc",
      limit: 25,
      offset: 50,
    })).resolves.toEqual({
      rows: [{ supplier: "Acme" }],
      schema: [{ name: "supplier", type: "string" }],
      rowCount: 3,
    })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(
      "https://platform.example/api/platform/dataset/ds%2Fwith%20space/rows" +
        "?select=supplier%2Camount" +
        "&where=%7B%22status%22%3A%22open%22%2C%22amount%22%3A%7B%22op%22%3A%22gte%22%2C%22value%22%3A10%7D%7D" +
        "&sort=amount%3Adesc&limit=25&offset=50",
    )
    expect(init).toEqual({
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer token_123",
      },
      body: undefined,
    })
  })

  it("maps aggregate inputs to the aggregate endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      rows: [{ group: "open", value: 12 }],
    }))
    const store = remoteDatasetStore({
      endpoint: "https://platform.example/api/platform/dataset",
      token: "token_123",
    })

    await expect(store.aggregate({
      datasetId: "ds_123",
      groupBy: "status",
      metric: "sum(amount)",
      where: { supplier: "Acme" },
    })).resolves.toEqual({
      rows: [{ group: "open", value: 12 }],
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://platform.example/api/platform/dataset/ds_123/aggregate" +
        "?metric=sum%28amount%29&groupBy=status&where=%7B%22supplier%22%3A%22Acme%22%7D",
    )
  })

  it("surfaces the platform error body and status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: false,
      error: "dataset_not_found",
    }, 404))
    const store = remoteDatasetStore({
      endpoint: "https://platform.example/api/platform/dataset",
      token: "token_123",
    })

    const failure = await store.rows({ datasetId: "missing" }).catch(error => error)
    expect(failure).toBeInstanceOf(RemoteDatasetStoreError)
    expect(failure).toMatchObject({
      operation: "rows",
      status: 404,
      body: { ok: false, error: "dataset_not_found" },
    })
    expect(failure.message).toBe(
      "remote_dataset_rows_failed_404:dataset_not_found",
    )
  })

  it("rejects more than 10,000 inline rows without truncating or fetching", async () => {
    const store = remoteDatasetStore({
      endpoint: "https://platform.example/api/platform/dataset",
      token: "token_123",
    })
    const rows = Array.from(
      { length: REMOTE_DATASET_MAX_INLINE_ROWS + 1 },
      (_, index) => ({ index }),
    )

    await expect(store.materialize({
      app: "app_123",
      env: "development",
      source: { kind: "rows", rows },
    })).rejects.toThrow(
      "remote_dataset_inline_rows_limit_exceeded:10001>10000",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

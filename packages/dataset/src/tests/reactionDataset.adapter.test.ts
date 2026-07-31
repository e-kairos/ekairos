import { beforeEach, describe, expect, it, vi } from "vitest"

const mock = vi.hoisted(() => {
  const reader = {
    read: vi.fn(async () => ({ rows: [{ id: "row_1" }], cursor: 1, done: true })),
  }
  const openedResult = {
    datasetId: "opened_dataset",
    dataset: { status: "completed", actualGeneratedRowCount: 2 },
    notation: null,
    previewRows: [{ id: "opened_row" }],
    reader,
  }
  const builtResult = {
    datasetId: "built_dataset",
    dataset: { calculatedTotalRows: 3 },
    notation: null,
    previewRows: [{ id: "built_row" }],
    reader,
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
    materializeDataset: vi.fn(() => builder),
    finalizeBuildResult: vi.fn(),
    openedResult,
    builtResult,
    reader,
  }
})

vi.mock("../dataset.js", () => ({
  materializeDataset: mock.materializeDataset,
}))
vi.mock("../builder/persistence.js", () => ({
  finalizeBuildResult: mock.finalizeBuildResult,
}))

import { buildReactionDataset } from "../reactionDataset.js"

function createInput(spec: any) {
  return {
    runtime: { env: { orgId: "org_1" } } as any,
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
  }
}

describe("Reaction Dataset adapter", () => {
  beforeEach(() => {
    mock.materializeDataset.mockClear()
    mock.finalizeBuildResult.mockReset()
    mock.reader.read.mockClear()
    for (const value of Object.values(mock.builder)) {
      if (typeof value?.mockClear === "function") value.mockClear()
    }
    mock.builder.build.mockResolvedValue(mock.builtResult)
  })

  it("opens an existing Dataset without rebuilding it", async () => {
    mock.finalizeBuildResult.mockResolvedValueOnce(mock.openedResult)

    const result = await buildReactionDataset(createInput({
      datasetId: "items_dataset",
      ensure: { source: { rows: [] } },
    }) as any)

    expect(result).toEqual({
      datasetId: "opened_dataset",
      mode: "opened",
      previewRows: [{ id: "opened_row" }],
      count: 2,
      reader: mock.reader,
    })
    expect(mock.materializeDataset).not.toHaveBeenCalled()
  })

  it("opens an existing Dataset explicitly for row reads", async () => {
    mock.finalizeBuildResult.mockResolvedValueOnce(mock.openedResult)

    const result = await buildReactionDataset(createInput({
      datasetId: "items_dataset",
      open: true,
    }) as any)

    expect(result.mode).toBe("opened")
    expect(result.reader).toBe(mock.reader)
    expect(mock.materializeDataset).not.toHaveBeenCalled()
  })

  it("deduplicates the same deterministic source and schema on retry", async () => {
    const spec = {
      datasetId: "stable_items_dataset",
      ensure: {
        source: { rows: [{ sku: "A-1" }] },
        schema: {
          schema: {
            type: "object",
            properties: { sku: { type: "string" } },
            required: ["sku"],
          },
        },
      },
    }
    mock.finalizeBuildResult
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce(mock.openedResult)

    const first = await buildReactionDataset(createInput(spec) as any)
    const second = await buildReactionDataset(createInput(spec) as any)

    expect(first.mode).toBe("built")
    expect(second.mode).toBe("opened")
    expect(mock.materializeDataset).toHaveBeenCalledTimes(1)
    expect(mock.builder.build).toHaveBeenCalledTimes(1)
  })

  it("maps file sources and keeps the parent Session boundary", async () => {
    mock.finalizeBuildResult.mockRejectedValueOnce(new Error("not found"))

    const result = await buildReactionDataset(createInput({
      datasetId: "items_dataset",
      ensure: {
        title: "Items",
        source: { files: [{ fileId: "file_1", description: "Excel" }] },
        instructions: "Extract item rows.",
        schema: { title: "Item", schema: {} },
        output: "object",
      },
    }) as any)

    expect(result).toEqual({
      datasetId: "built_dataset",
      mode: "built",
      previewRows: [{ id: "built_row" }],
      count: 3,
      reader: mock.reader,
    })
    expect(mock.materializeDataset).toHaveBeenCalledWith(
      expect.objectContaining({ env: { orgId: "org_1" } }),
      { datasetId: "items_dataset", parentSessionId: "session_1" },
    )
    expect(mock.builder.sandbox).toHaveBeenCalledWith("sandbox_1")
    expect(mock.builder.title).toHaveBeenCalledWith("Items")
    expect(mock.builder.from).toHaveBeenCalledWith({
      kind: "file",
      fileId: "file_1",
      description: "Excel",
      filename: undefined,
      mediaType: undefined,
    })
    expect(mock.builder.engine).toHaveBeenCalledWith({ kind: "dataset-engine" })
    expect(mock.builder.instructions).toHaveBeenCalledWith("Extract item rows.")
    expect(mock.builder.schema).toHaveBeenCalledWith({ title: "Item", schema: {} })
    expect(mock.builder.asObject).toHaveBeenCalled()
  })

  it("maps Dataset, row, and query sources explicitly", async () => {
    mock.finalizeBuildResult.mockRejectedValue(new Error("not found"))

    await buildReactionDataset(createInput({
      datasetId: "derived_dataset",
      ensure: {
        source: { datasets: [{ datasetId: "source_dataset", description: "Offers" }] },
      },
    }) as any)
    expect(mock.builder.from).toHaveBeenLastCalledWith({
      kind: "dataset",
      datasetId: "source_dataset",
      description: "Offers",
    })

    await buildReactionDataset(createInput({
      datasetId: "rows_dataset",
      ensure: {
        source: { rows: [{ sku: "A1" }], name: "items.jsonl" },
      },
    }) as any)
    expect(mock.builder.fromText).toHaveBeenLastCalledWith({
      text: "{\"type\":\"row\",\"data\":{\"sku\":\"A1\"}}\n",
      mimeType: "application/x-ndjson",
      name: "items.jsonl",
      description: undefined,
    })

    const query = { dataset_records: {} }
    const sourceDomain = { name: "source" }
    await buildReactionDataset(createInput({
      datasetId: "query_dataset",
      ensure: { source: { query, domain: sourceDomain, title: "Rows" } },
    }) as any)
    expect(mock.builder.fromQuery).toHaveBeenLastCalledWith(sourceDomain, {
      query,
      title: "Rows",
      explanation: undefined,
    })
  })

  it("rejects a query source without its Domain", async () => {
    mock.finalizeBuildResult.mockRejectedValueOnce(new Error("not found"))

    await expect(buildReactionDataset(createInput({
      datasetId: "query_dataset",
      ensure: { source: { query: { dataset_records: {} } } },
    }) as any)).rejects.toThrow("dataset_query_source_requires_domain")
  })
})

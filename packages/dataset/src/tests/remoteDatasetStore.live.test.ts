import { describe, expect, it } from "vitest"

import {
  remoteDatasetOptionsFromEnv,
} from "../reactionDataset.js"

const requiredEnv = [
  "EKAIROS_DATASET_ENDPOINT",
  "EKAIROS_DATASET_TOKEN",
  "EKAIROS_DATASET_APP",
  "EKAIROS_DATASET_ENV",
] as const
const hasLiveEnvironment = requiredEnv.every(name =>
  Boolean(String(process.env[name] ?? "").trim()))
const options = hasLiveEnvironment
  ? remoteDatasetOptionsFromEnv()
  : undefined
const describeRemote = options ? describe : describe.skip

describeRemote("remoteDatasetStore live", () => {
  it("materializes, reads, and aggregates through the configured endpoint", async () => {
    const marker = `live-${Date.now()}`
    const materialized = await options!.store.materialize({
      ...options!.scope,
      name: `@ekairos/dataset ${marker}`,
      source: {
        kind: "rows",
        origin: "@ekairos/dataset-live-test",
        rows: [
          { marker, group: "a", amount: 2 },
          { marker, group: "a", amount: 3 },
        ],
      },
    })

    expect(materialized.datasetId).toBeTruthy()
    expect(materialized.rowCount).toBe(2)

    const rows = await options!.store.rows({
      datasetId: materialized.datasetId,
      sort: "amount:asc",
      limit: 10,
      offset: 0,
    })
    expect(rows.rows).toEqual([
      { marker, group: "a", amount: 2 },
      { marker, group: "a", amount: 3 },
    ])
    expect(rows.rowCount).toBe(2)

    const aggregate = await options!.store.aggregate({
      datasetId: materialized.datasetId,
      groupBy: "group",
      metric: "sum(amount)",
    })
    expect(aggregate.rows).toEqual([{ group: "a", value: 5 }])
  })
})

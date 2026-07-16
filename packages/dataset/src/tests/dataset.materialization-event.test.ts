/* @vitest-environment node */

import { lookup } from "@instantdb/admin"
import { describe, expect, it } from "vitest"

import { createDatasetTriggerEvent } from "../builder/materialize.js"
import { datasetDomain } from "../schema.js"

describe("dataset materialization event", () => {
  it("declares reflective dataset and file links", () => {
    const event = datasetDomain.events.materializationRequested

    expect({
      domain: event.domain,
      name: event.name,
      kind: event.kind,
      links: event.links,
    }).toEqual({
      domain: "dataset",
      name: "materializationRequested",
      kind: "dataset.materializationRequested",
      links: {
        target: { on: "dataset_datasets", has: "one" },
        sources: { on: "dataset_datasets", has: "many" },
        file: { on: "$files", has: "one" },
      },
    })
    expect(datasetDomain.links[event.physicalLinks.target.key]).toMatchObject({
      forward: { on: "context_events", has: "one" },
      reverse: { on: "dataset_datasets", has: "many" },
    })
  })

  it("constructs a file request with a real file and dataset lookup", () => {
    const draft = createDatasetTriggerEvent({
      mode: "file",
      prompt: "Read the uploaded workbook",
      targetDatasetId: "dataset-output",
      fileId: "file-id",
    })

    expect(draft.payload).toEqual({
      mode: "file",
      prompt: "Read the uploaded workbook",
    })
    expect(draft.links).toEqual({
      target: lookup("datasetId", "dataset-output"),
      file: "file-id",
    })
  })

  it("constructs a transform request with source and target lookups", () => {
    const draft = createDatasetTriggerEvent({
      mode: "transform",
      prompt: "Combine the source datasets",
      targetDatasetId: "dataset-output",
      sourceDatasetIds: ["dataset-a", "dataset-b"],
    })

    expect(draft.links).toEqual({
      target: lookup("datasetId", "dataset-output"),
      sources: [lookup("datasetId", "dataset-a"), lookup("datasetId", "dataset-b")],
    })
    expect(draft.links).not.toHaveProperty("file")
  })
})

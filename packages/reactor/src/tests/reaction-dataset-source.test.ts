import type { ContextEvent } from "@ekairos/events"
import { describe, expect, it } from "vitest"

import { deriveDatasetSource } from "../reaction.operation.contract.js"

function loadedFilesEvent(): ContextEvent {
  return {
    id: "loaded",
    type: "context.loadFiles",
    createdAt: new Date("2026-07-17T12:00:00.000Z"),
    payload: {
      path: "contexts/context-1/files",
      files: [
        { fileId: "file-1", path: "contexts/context-1/files/file-1/request.md" },
        { fileId: "file-2", path: "contexts/context-1/files/file-2/spec.pdf" },
      ],
    },
    links: {},
    physicalLinks: {},
    metadata: {},
    eventParts: [],
  }
}

describe("Reaction Dataset source", () => {
  it("keeps loadFiles as an explicit file source instead of treating its manifest as rows", () => {
    expect(deriveDatasetSource([loadedFilesEvent()])).toEqual({
      files: [{ fileId: "file-1" }, { fileId: "file-2" }],
    })
  })
})

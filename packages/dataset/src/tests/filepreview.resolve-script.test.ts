import { describe, expect, it } from "vitest"

import { getEmbeddedFilePreviewScriptBase64 } from "../file/filepreview"

describe("file preview scripts", () => {
  it("embeds Python preview scripts for inline sandbox execution", () => {
    const content = Buffer.from(
      getEmbeddedFilePreviewScriptBase64("file_metadata.py"),
      "base64",
    ).toString("utf8")

    expect(content).toContain("json")
    expect(content).toContain("row_count_estimate")
  })
})

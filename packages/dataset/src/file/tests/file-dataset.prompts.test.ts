/* @vitest-environment node */

import { describe, expect, it } from "vitest"

import { buildFileDatasetPrompt } from "../prompts.js"

describe("file dataset prompt", () => {
  it("projects the source identity and durable context workspace path", () => {
    const prompt = buildFileDatasetPrompt({
      datasetId: "dataset-award-items",
      fileId: "file-provider-offer",
      instructions: "Map every source code to its tender item.",
      sandboxConfig: {
        filePath: "/tmp/ekairos/contexts/context-1/events/event-1/parts/1/file",
        contextPath: "/tmp/ekairos/contexts/context-1/executions/execution-1/context.md",
        outputPath: "/tmp/ekairos/contexts/context-1/executions/execution-1/output/output.jsonl",
        scriptsDir: "/tmp/ekairos/contexts/context-1/executions/execution-1/scripts",
      },
      analysis: [],
      schema: null,
      plan: null,
      executionResult: null,
      errors: [],
      iterationCount: 0,
    })

    expect(prompt).toContain("<FileId>file-provider-offer</FileId>")
    expect(prompt).toContain("<ContextPath>/tmp/ekairos/contexts/context-1/executions/execution-1/context.md</ContextPath>")
    expect(prompt).toContain("read or parse that workspace file directly")
    expect(prompt).toContain("do not copy large mappings from the prompt")
  })
})

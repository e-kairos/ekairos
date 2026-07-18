import { describe, expect, it } from "vitest"

import {
  contextWorkspacePath,
  resolveContextWorkspacePath,
  workspaceKey,
} from "../workspace-path.js"

describe("Context workspace paths", () => {
  it("builds portable Context-owned paths and resolves them under the provider root", () => {
    const path = contextWorkspacePath("context-1", "repositories", "platform")

    expect(path).toBe("contexts/context-1/repositories/platform")
    expect(resolveContextWorkspacePath("/workspace", "context-1", path))
      .toBe("/workspace/contexts/context-1/repositories/platform")
    expect(resolveContextWorkspacePath("C:\\workspace", "context-1", path))
      .toBe("C:\\workspace\\contexts\\context-1\\repositories\\platform")
  })

  it("rejects absolute, traversing, and cross-Context paths", () => {
    expect(() => resolveContextWorkspacePath("/workspace", "context-1", "/workspace/repo" as never))
      .toThrow("reaction_path_must_be_relative")
    expect(() => resolveContextWorkspacePath(
      "/workspace",
      "context-1",
      "contexts/context-1/../context-2/repo" as never,
    )).toThrow("reaction_path_invalid")
    expect(() => resolveContextWorkspacePath(
      "/workspace",
      "context-1",
      "contexts/context-2/repositories/platform" as never,
    )).toThrow("reaction_path_outside_context")
  })

  it("encodes identifiers so they cannot create path segments", () => {
    expect(contextWorkspacePath("../context", "files", workspaceKey("../file"), "quote.pdf"))
      .toBe("contexts/%2E%2E%2Fcontext/files/%2E%2E%2Ffile/quote.pdf")
  })
})

/* @vitest-environment node */

import { isAbsolute, join, relative } from "node:path"

import { describe, expect, it } from "vitest"

import {
  CONTEXT_LOCAL_SEGMENT_MAX_LENGTH,
  getContextExecutionLocalRoot,
  getContextLocalRoot,
  getContextPartLocalRoot,
  getContextResourceLocalRoot,
  getContextStepLocalRoot,
  safeContextLocalFilename,
  safeContextLocalSegment,
} from "../context.local-paths.ts"

function isInside(parent: string, child: string) {
  const rel = relative(parent, child)
  return rel === "" || (Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel))
}

describe("context local paths", () => {
  it("normalizes local segments without allowing path separators or empty names", () => {
    expect(safeContextLocalSegment(" Factura áéí 00009/00021351.pdf ", "fallback"))
      .toBe("Factura_aei_00009_00021351.pdf")
    expect(safeContextLocalSegment("../..", "fallback")).toBe("fallback")
    expect(safeContextLocalSegment("", "fallback")).toBe("fallback")
    expect(safeContextLocalFilename("../../invoice.pdf", "fallback.pdf")).toBe("invoice.pdf")
  })

  it("limits path segments to a bounded length", () => {
    const long = "x".repeat(CONTEXT_LOCAL_SEGMENT_MAX_LENGTH + 25)
    expect(safeContextLocalSegment(long, "fallback")).toHaveLength(CONTEXT_LOCAL_SEGMENT_MAX_LENGTH)
  })

  it("derives all canonical context paths under the configured base path", () => {
    const basePath = join("C:", "ekairos-workspace")
    const contextId = "../../context:danger"
    const executionId = "../execution:danger"
    const stepId = "../step:danger"
    const partId = "../part:danger"

    const contextRoot = getContextLocalRoot({ basePath, contextId })
    const resourceRoot = getContextResourceLocalRoot({
      basePath,
      contextId,
      resourceKey: "../resource:danger",
    })
    const executionRoot = getContextExecutionLocalRoot({ basePath, contextId, executionId })
    const stepRoot = getContextStepLocalRoot({ basePath, contextId, executionId, stepId })
    const partRoot = getContextPartLocalRoot({ basePath, contextId, executionId, stepId, partId })

    for (const path of [contextRoot, resourceRoot, executionRoot, stepRoot, partRoot]) {
      expect(isInside(basePath, path)).toBe(true)
      expect(path).not.toContain("..")
    }

    expect(resourceRoot).toContain(join("resources", "resource_danger"))
    expect(partRoot).toContain(join("steps", "step_danger", "parts", "part_danger"))
  })
})

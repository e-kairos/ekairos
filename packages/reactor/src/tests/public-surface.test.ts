import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import * as root from "../index.ts"
import * as internal from "../internal.ts"

describe("@ekairos/reactor public surface", () => {
  it("keeps root as the new Reactor DX only", () => {
    expect(Object.keys(root).sort()).toEqual([
      "Session",
      "ai",
      "isAiEngine",
      "toModelActionName",
    ])
  })

  it("keeps internal as a narrow cross-package bridge", () => {
    expect(Object.keys(internal).sort()).toEqual(["Session", "getSessionId"])
  })

  it("does not publish the old context subpath", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    )

    expect(Object.keys(packageJson.exports).sort()).toEqual([
      ".",
      "./internal",
    ])
    expect(packageJson.exports).not.toHaveProperty("./context")
  })
})

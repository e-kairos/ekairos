import { describe, expect, it } from "vitest"

import { uuidV5 } from "../context.part-identity.js"

describe("Context identity", () => {
  it("creates stable UUID v5 identifiers", () => {
    const first = uuidV5("session:operation:1")
    const second = uuidV5("session:operation:1")
    const other = uuidV5("session:operation:2")

    expect(first).toBe(second)
    expect(first).not.toBe(other)
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(first[14]).toBe("5")
  })
})

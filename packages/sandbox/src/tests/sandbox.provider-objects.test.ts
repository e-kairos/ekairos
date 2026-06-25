import { afterEach, describe, expect, it } from "vitest"

import { resolveProvider } from "../providers/provider"

describe("sandbox provider resolution", () => {
  afterEach(() => {
    delete process.env.SANDBOX_PROVIDER
  })

  it("accepts provider objects", () => {
    expect(resolveProvider({ provider: { kind: "justbash" } })).toBe("justbash")
    expect(resolveProvider({ provider: { kind: "agentos" } })).toBe("agentos")
    expect(resolveProvider({ provider: { kind: "local" } })).toBe("local")
    expect(resolveProvider({ provider: { kind: "vercel" } })).toBe("vercel")
    expect(resolveProvider({ provider: { kind: "daytona" } })).toBe("daytona")
    expect(resolveProvider({ provider: { kind: "sprites" } })).toBe("sprites")
  })

  it("keeps string and environment selectors", () => {
    expect(resolveProvider({ provider: "local" })).toBe("local")

    process.env.SANDBOX_PROVIDER = "agentos"
    expect(resolveProvider({})).toBe("agentos")
  })

  it("defaults to sprites", () => {
    expect(resolveProvider({})).toBe("sprites")
  })
})

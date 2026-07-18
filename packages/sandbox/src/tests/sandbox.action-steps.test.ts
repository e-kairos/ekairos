import { describe, expect, it, vi } from "vitest"

import { getSandboxStep } from "../action-steps.js"

describe("sandbox action runtime adapter", () => {
  it("resolves the scoped database from EkairosRuntime.db()", async () => {
    const query = vi.fn(async () => ({
      sandbox_sandboxes: [{ id: "sandbox-1", provider: "daytona" }],
    }))
    const db = vi.fn(async () => ({ query }))

    const result = await getSandboxStep({
      runtime: { db },
      input: { sandboxId: "sandbox-1" },
    })

    expect(db).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledWith({
      sandbox_sandboxes: { $: { where: { id: "sandbox-1" }, limit: 1 } },
    })
    expect(result).toEqual({
      ok: true,
      data: { id: "sandbox-1", provider: "daytona" },
    })
  })

  it("continues to accept an already resolved database", async () => {
    const query = vi.fn(async () => ({ sandbox_sandboxes: [] }))

    const result = await getSandboxStep({
      runtime: { db: { query } },
      input: { sandboxId: "missing" },
    })

    expect(result).toEqual({ ok: false, error: "sandbox_not_found" })
  })
})

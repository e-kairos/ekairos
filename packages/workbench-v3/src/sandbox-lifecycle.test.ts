import { describe, expect, it, vi } from "vitest"

import { resolveSandboxLease } from "./sandbox-lifecycle"

describe("Workbench sandbox lifecycle", () => {
  it("reuses a reachable remote sandbox", async () => {
    const create = vi.fn(async () => "sandbox-new")

    const result = await resolveSandboxLease("sandbox-current", {
      probe: async () => ({ success: true }),
      create,
    })

    expect(result).toEqual({ sandboxId: "sandbox-current", replaced: false })
    expect(create).not.toHaveBeenCalled()
  })

  it("creates a replacement when the provider no longer has the sandbox", async () => {
    const create = vi.fn(async () => "sandbox-new")

    const result = await resolveSandboxLease("sandbox-missing", {
      probe: async () => ({
        success: false,
        error: "Sandbox with ID or name remote-123 not found",
      }),
      create,
    })

    expect(result).toEqual({ sandboxId: "sandbox-new", replaced: true })
    expect(create).toHaveBeenCalledOnce()
  })

  it("also replaces a sandbox when opening it reports a missing durable handle", async () => {
    const result = await resolveSandboxLease("sandbox-missing", {
      probe: async () => { throw new Error("sandbox_not_found:sandbox-missing") },
      create: async () => "sandbox-new",
    })

    expect(result).toEqual({ sandboxId: "sandbox-new", replaced: true })
  })

  it("replaces a lease already marked as terminal after a failed reconnect", async () => {
    const result = await resolveSandboxLease("sandbox-shutdown", {
      probe: async () => ({ success: false, error: "sandbox_not_active:shutdown" }),
      create: async () => "sandbox-new",
    })

    expect(result).toEqual({ sandboxId: "sandbox-new", replaced: true })
  })

  it("does not hide provider, network, or credential failures", async () => {
    const create = vi.fn(async () => "sandbox-new")

    await expect(resolveSandboxLease("sandbox-current", {
      probe: async () => ({ success: false, error: "DAYTONA_API_KEY is invalid" }),
      create,
    })).rejects.toThrow("DAYTONA_API_KEY is invalid")
    expect(create).not.toHaveBeenCalled()
  })

  it("does not replace a lease in a non-terminal transition", async () => {
    const create = vi.fn(async () => "sandbox-new")

    await expect(resolveSandboxLease("sandbox-creating", {
      probe: async () => ({ success: false, error: "sandbox_not_active:creating" }),
      create,
    })).rejects.toThrow("sandbox_not_active:creating")
    expect(create).not.toHaveBeenCalled()
  })
})

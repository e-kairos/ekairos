import { describe, expect, it, vi } from "vitest"

import { SandboxService } from "../service"

describe("SandboxService command context", () => {
  it("forwards path and environment to Daytona", async () => {
    const executeCommand = vi.fn(async () => ({
      exitCode: 0,
      result: "/home/daytona/project\n",
    }))
    const service = new SandboxService({} as any)
    vi.spyOn(service as any, "reconnectToSandbox").mockResolvedValue({
      ok: true,
      data: {
        sandbox: { process: { executeCommand } },
      },
    })

    const result = await service.runCommand(
      "sandbox-1",
      "node",
      ["script.js", "hello world"],
      {
        cwd: "/home/daytona/project",
        env: { REPORT_NAME: "Review 1\nSecond line" },
      },
    )

    expect(result).toMatchObject({
      ok: true,
      data: { success: true, output: "/home/daytona/project\n" },
    })
    expect(executeCommand).toHaveBeenCalledWith(
      "REPORT_NAME='Review 1\nSecond line'; export REPORT_NAME; node script.js 'hello world'",
      "/home/daytona/project",
    )
  })

  it("rejects invalid environment keys before provider execution", async () => {
    const executeCommand = vi.fn()
    const service = new SandboxService({} as any)
    vi.spyOn(service as any, "reconnectToSandbox").mockResolvedValue({
      ok: true,
      data: { sandbox: { process: { executeCommand } } },
    })

    await expect(service.runCommand("sandbox-1", "true", [], {
      env: { "BAD-KEY": "value" },
    })).resolves.toEqual({ ok: false, error: "sandbox_env_key_invalid:BAD-KEY" })
    expect(executeCommand).not.toHaveBeenCalled()
  })
})

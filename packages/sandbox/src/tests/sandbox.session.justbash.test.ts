import { describe, expect, it } from "vitest"

import { createSandboxSession, justBashSandbox } from "../session"

describe("JustBash sandbox session", () => {
  it("runs commands and reads/writes files through the session contract", async () => {
    const session = await createSandboxSession(
      justBashSandbox({
        cwd: "/workspace",
      }),
    )

    try {
      expect(session.provider).toBe("justbash")
      expect(session.workspaceRoot).toBe("/workspace")

      await session.writeFile({
        path: "/workspace/input.txt",
        content: "hello from justbash",
      })

      await expect(session.exists("/workspace/input.txt")).resolves.toBe(true)
      await expect(session.exists("/workspace")).resolves.toBe(true)
      await expect(session.exists("/workspace/missing.txt")).resolves.toBe(false)

      const output = await session.exec({
        command: "cat",
        args: ["/workspace/input.txt"],
      })

      expect(output.success).toBe(true)
      expect(output.exitCode).toBe(0)
      expect(output.output).toContain("hello from justbash")

      const bytes = await session.readFile("/workspace/input.txt")
      expect(Buffer.from(bytes).toString("utf8")).toBe("hello from justbash")
    } finally {
      await session.stop()
    }
  })
})

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { createSandboxSession, localSandbox } from "../session"

describe("local sandbox session", () => {
  it("runs local commands and reads/writes files through the session contract", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ekairos-local-sandbox-test-"))
    const session = await createSandboxSession(
      localSandbox({
        basePath: workspaceRoot,
        cleanup: true,
      }),
    )

    try {
      expect(session.provider).toBe("local")
      expect(session.workspaceRoot).toBe(workspaceRoot)

      const filePath = join(workspaceRoot, "nested", "input.txt")
      await session.writeFile({
        path: filePath,
        content: "hello from local",
      })

      const bytes = await session.readFile(filePath)
      expect(Buffer.from(bytes).toString("utf8")).toBe("hello from local")

      const output = await session.exec({
        command: process.execPath,
        args: ["-e", "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8'))", filePath],
      })

      expect(output.success).toBe(true)
      expect(output.exitCode).toBe(0)
      expect(output.output).toBe("hello from local")
    } finally {
      await session.stop()
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})

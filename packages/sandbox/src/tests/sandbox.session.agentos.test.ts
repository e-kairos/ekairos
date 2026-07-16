import { describe, expect, it } from "vitest"

import {
  agentOsSandbox,
  createAgentOsSandboxFs,
  createAgentOsSandboxToolkit,
  createSandboxSession,
  type AgentOsSandboxClient,
} from "../session"

describe("AgentOS sandbox session", () => {
  it("adapts a SandboxAgent client to the session contract", async () => {
    const files = new Map<string, Uint8Array>()
    const mkdirCalls: string[] = []
    let destroyed = false

    const client: AgentOsSandboxClient = {
      sandboxId: "agentos-test",
      async mkdirFs(query) {
        mkdirCalls.push(query.path)
        return { path: query.path }
      },
      async runProcess(request) {
        return {
          durationMs: 1,
          exitCode: 0,
          stderr: "",
          stderrTruncated: false,
          stdout: [request.command, ...(request.args ?? [])].join(" "),
          stdoutTruncated: false,
          timedOut: false,
        }
      },
      async writeFsFile(query, body) {
        files.set(query.path, new Uint8Array(Buffer.from(body as Uint8Array)))
        return { bytesWritten: files.get(query.path)?.byteLength ?? 0, path: query.path }
      },
      async readFsFile(query) {
        return files.get(query.path) ?? new Uint8Array()
      },
      async statFs(query) {
        if (files.has(query.path)) {
          return {
            entryType: "file",
            path: query.path,
            size: files.get(query.path)?.byteLength ?? 0,
          }
        }
        if (mkdirCalls.includes(query.path)) {
          return {
            entryType: "directory",
            path: query.path,
            size: 0,
          }
        }
        throw Object.assign(new Error(`Missing path: ${query.path}`), { status: 404 })
      },
      async destroySandbox() {
        destroyed = true
      },
    }

    const session = await createSandboxSession(
      agentOsSandbox({
        client,
        basePath: "/workspace",
      }),
    )

    expect(session.id).toBe("agentos-test")
    expect(session.provider).toBe("agentos")
    expect(session.workspaceRoot).toBe("/workspace")
    expect(mkdirCalls).toEqual(["/workspace"])

    await session.writeFile({
      path: "/workspace/input.txt",
      content: "hello from agentos",
    })

    const bytes = await session.readFile("/workspace/input.txt")
    expect(Buffer.from(bytes).toString("utf8")).toBe("hello from agentos")
    await expect(session.exists("/workspace/input.txt")).resolves.toBe(true)
    await expect(session.exists("/workspace")).resolves.toBe(true)
    await expect(session.exists("/workspace/missing.txt")).resolves.toBe(false)

    const output = await session.exec({
      command: "echo",
      args: ["ready"],
    })
    expect(output).toMatchObject({
      success: true,
      exitCode: 0,
      output: "echo ready",
    })

    await session.stop()
    expect(destroyed).toBe(true)
  })

  it("re-exports the AgentOS filesystem/toolkit factories", () => {
    expect(createAgentOsSandboxFs).toBeTypeOf("function")
    expect(createAgentOsSandboxToolkit).toBeTypeOf("function")
  })
})

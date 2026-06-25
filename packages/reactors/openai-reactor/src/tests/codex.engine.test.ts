import type { ContextItem } from "@ekairos/events"
import type { SandboxExecInput, SandboxFileInput, SandboxSession } from "@ekairos/sandbox"
import { describe, expect, it } from "vitest"

import { codexEngine } from "../codex.engine"

function triggerEvent(): ContextItem {
  return {
    id: "evt-trigger",
    type: "input",
    channel: "test",
    createdAt: new Date("2026-06-25T00:00:00.000Z").toISOString(),
    status: "stored",
    content: {},
  }
}

function fakeSandbox() {
  const files: SandboxFileInput[] = []
  const commands: SandboxExecInput[] = []
  const session: SandboxSession = {
    id: "sandbox-test",
    provider: "local",
    workspaceRoot: "/workspace",
    handle: {},
    async exec(input) {
      commands.push(input)
      const command = [input.command, ...(input.args ?? [])].join(" ")
      if (command.includes("codex-turn-runner")) {
        return {
          success: true,
          exitCode: 0,
          output: [
            "EKAIROS_CODEX_RESULT\t" +
              JSON.stringify({
                providerContextId: "thread-1",
                turnId: "turn-1",
                assistantText: JSON.stringify({ answer: "ok" }),
              }),
          ].join("\n"),
          error: "",
          command,
        }
      }
      return {
        success: true,
        exitCode: 0,
        output: "codex_engine_prepare_ok\ncodex_engine_bridge_ok\n",
        error: "",
        command,
      }
    },
    async writeFile(file) {
      files.push(file)
    },
    async writeFiles(input) {
      files.push(...input)
    },
    async readFile() {
      return new Uint8Array()
    },
    async stop() {},
  }
  return { session, files, commands }
}

function stepInput(sandbox?: SandboxSession) {
  return {
    reactorKey: "test.reactor",
    context: {
      ref: { id: "ctx-1", key: "ctx:test" },
      content: {},
    },
    scope: {},
    env: {},
    triggerEvent: triggerEvent(),
    executionId: "exec-1",
    sandbox,
    workspaceRoot: sandbox?.workspaceRoot,
    step: {
      key: "answer",
      instructions: "Return an answer.",
    },
    actions: {},
  }
}

describe("codexEngine", () => {
  it("requires a sandbox session", async () => {
    await expect(codexEngine().step(stepInput())).rejects.toThrow(
      "codex_engine_sandbox_required",
    )
  })

  it("runs Codex through the provided sandbox session", async () => {
    const { session, files, commands } = fakeSandbox()

    const output = await codexEngine({
      auth: { source: "preinstalled" },
      installCodexCli: false,
      model: "openai/gpt-5.2-codex",
    }).step(stepInput(session))

    expect(output).toEqual(JSON.stringify({ answer: "ok" }))
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "/workspace/.ekairos/codex/codex-bridge.mjs",
        "/workspace/.ekairos/codex/codex-turn-runner.mjs",
        "/workspace/.ekairos/codex/instruction-exec-1-answer.txt",
      ]),
    )
    expect(commands).toHaveLength(3)
    expect(commands[2]?.args?.join(" ")).toContain("codex-turn-runner")
  })
})

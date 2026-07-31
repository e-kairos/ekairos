import { spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import {
  mkdtemp,
  mkdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"

import {
  toModelActionName,
  type ReactionEngineInput,
} from "@ekairos/reactor"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { codexEngine } from "../codex.engine.js"
import { resolveCodexExecutable } from "../codex.local.js"

vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: vi.fn(),
}))

function agentInput(
  actions: ReactionEngineInput["actions"] = {},
): ReactionEngineInput {
  const trigger = {
    id: "evt-trigger",
    type: "inbox.messageReceived",
    domain: "inbox",
    name: "messageReceived",
    channel: "test",
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
    payload: { message: "Choose a supplier" },
    links: {},
    physicalLinks: {},
    metadata: {},
    eventParts: [],
  }
  return {
    reactionKey: "award.answer",
    runtime: {} as ReactionEngineInput["runtime"],
    context: {
      ref: { id: "ctx-1", key: "ctx:award" },
      content: { phase: "current-context" },
    },
    trigger,
    sessionId: "session-1",
    reactionId: "reaction-1",
    given: [trigger],
    messages: [{
      role: "user",
      content: [{ type: "text", text: "Choose the approved supplier." }],
    }] as any,
    instruction: "Choose the approved supplier.",
    actions,
  }
}

function fakeAppServerProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    killed: boolean
    kill: ReturnType<typeof vi.fn>
    unref: ReturnType<typeof vi.fn>
  }
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = vi.fn(() => {
    child.killed = true
    return true
  })
  child.unref = vi.fn()
  let inputBuffer = ""
  let threadIndex = 0
  let turnIndex = 0

  const send = (message: unknown) => {
    child.stdout.write(`${JSON.stringify(message)}\n`)
  }
  const complete = (threadId: string, turnId: string, text: string) => {
    send({
      method: "item/agentMessage/delta",
      params: { threadId, turnId, delta: text },
    })
    send({
      method: "turn/completed",
      params: { threadId, turnId, turn: { id: turnId, status: "completed" } },
    })
  }

  child.stdin.on("data", chunk => {
    inputBuffer += String(chunk)
    const lines = inputBuffer.split("\n")
    inputBuffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line) continue
      const message = JSON.parse(line)
      if (message.method === "initialize") {
        send({ id: message.id, result: {} })
        continue
      }
      if (message.method === "initialized") continue
      if (message.method === "thread/start") {
        threadIndex += 1
        send({
          id: message.id,
          result: { thread: { id: `thread-${threadIndex}` } },
        })
        continue
      }
      if (message.method === "turn/start") {
        turnIndex += 1
        const threadId = message.params.threadId
        const turnId = `turn-${turnIndex}`
        send({ id: message.id, result: { turn: { id: turnId } } })
        if (turnIndex === 1) {
          send({
            id: "tool-request-1",
            method: "item/tool/call",
            params: {
              threadId,
              turnId,
              callId: "call-1",
              name: toModelActionName("supplier.lookup"),
              arguments: { supplierId: "supplier-7" },
            },
          })
        } else {
          complete(threadId, turnId, "second turn")
        }
        continue
      }
      if (message.id === "tool-request-1" && message.result) {
        complete("thread-1", "turn-1", JSON.stringify({ selected: "supplier-7" }))
      }
    }
  })

  return child
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe("local codexEngine", () => {
  it.runIf(process.platform === "win32")(
    "prefers the newest versioned Codex Desktop executable over the stale root binary",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "ekairos-codex-bin-"))
      const desktopBin = join(root, "OpenAI", "Codex", "bin")
      const oldDirectory = join(desktopBin, "old-version")
      const currentDirectory = join(desktopBin, "current-version")
      await mkdir(oldDirectory, { recursive: true })
      await mkdir(currentDirectory, { recursive: true })
      await writeFile(join(desktopBin, "codex.exe"), "")
      await writeFile(join(oldDirectory, "codex.exe"), "")
      await writeFile(join(currentDirectory, "codex.exe"), "")
      await utimes(join(oldDirectory, "codex.exe"), new Date(1), new Date(1))
      await utimes(join(currentDirectory, "codex.exe"), new Date(2), new Date(2))
      vi.stubEnv("LOCALAPPDATA", root)
      vi.stubEnv("PATH", "")

      try {
        await expect(resolveCodexExecutable()).resolves.toBe(
          join(currentDirectory, "codex.exe"),
        )
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it("spawns one reusable app-server and preserves tools plus structured output", async () => {
    const child = fakeAppServerProcess()
    vi.mocked(spawn).mockReturnValue(child as any)
    const received: unknown[] = []
    const engine = codexEngine({
      codexPath: "C:\\OpenAI\\current\\codex.exe",
      codexHome: "C:\\Users\\tester\\.codex",
      model: "gpt-5.6",
      repoPath: "C:\\work\\flagship",
    })
    const firstInput = agentInput({
      "supplier.lookup": {
        description: "Load a supplier.",
        input: z.object({ supplierId: z.string() }),
        output: z.object({ found: z.boolean() }),
        async execute(value) {
          received.push(value)
          return { found: true }
        },
      },
    })
    firstInput.output = z.object({ selected: z.string() })

    const first = await engine.agent(firstInput)
    const second = await engine.agent(agentInput())

    expect(first.output).toEqual({ selected: "supplier-7" })
    expect(first.parts).toEqual([
      expect.objectContaining({
        type: "action",
        content: expect.objectContaining({
          status: "started",
          actionName: "supplier.lookup",
        }),
      }),
      expect.objectContaining({
        type: "action",
        content: expect.objectContaining({
          status: "completed",
          actionName: "supplier.lookup",
        }),
      }),
    ])
    expect(second.output).toBe("second turn")
    expect(received).toEqual([{ supplierId: "supplier-7" }])
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith(
      "C:\\OpenAI\\current\\codex.exe",
      ["app-server", "--enable", "apps"],
      expect.objectContaining({
        env: expect.objectContaining({
          CODEX_HOME: "C:\\Users\\tester\\.codex",
        }),
        windowsHide: true,
      }),
    )
  })
})

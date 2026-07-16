import type { ReactionEngineInput } from "@ekairos/reactor"
import type { SandboxExecInput, SandboxFileInput, SandboxSession } from "@ekairos/sandbox"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { CodexEngine, codexEngine } from "../codex.engine"
import * as publicApi from "../index"

function fileText(file: SandboxFileInput): string {
  return typeof file.content === "string"
    ? file.content
    : Buffer.from(file.content).toString("utf8")
}

function completedTurn(assistantText = JSON.stringify({ answer: "ok" })) {
  return {
    status: "completed",
    providerContextId: "thread-1",
    turnId: "turn-1",
    assistantText,
    reasoningText: "reasoning",
    diff: "",
    usage: { inputTokens: 10 },
    completedTurn: { id: "turn-1", status: "completed" },
  }
}

function fakeSandbox(
  runTurn: (turnIndex: number) => Record<string, unknown> = () => completedTurn(),
) {
  const files: SandboxFileInput[] = []
  const commands: SandboxExecInput[] = []
  let turnIndex = 0
  const session: SandboxSession = {
    id: "sandbox-test",
    provider: "local",
    workspaceRoot: "/workspace",
    handle: {},
    async exec(input) {
      commands.push(input)
      const command = [input.command, ...(input.args ?? [])].join(" ")
      if (command.includes("codex-turn-runner")) {
        const payload = runTurn(turnIndex++)
        return {
          success: true,
          exitCode: 0,
          output: `EKAIROS_CODEX_RESULT\t${JSON.stringify(payload)}`,
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
    async writeFile(file) { files.push(file) },
    async writeFiles(input) { files.push(...input) },
    async readFile() { return new Uint8Array() },
    async exists() { return false },
    async stop() {},
  }
  return { session, files, commands }
}

function agentInput(
  sandbox?: SandboxSession,
  actions: ReactionEngineInput["actions"] = {},
): ReactionEngineInput {
  const trigger = {
    id: "evt-trigger",
    type: "inbox.messageReceived",
    domain: "inbox",
    name: "messageReceived",
    channel: "test",
    createdAt: new Date("2026-06-25T00:00:00.000Z"),
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
      previous: { phase: "previous-context" },
    },
    trigger,
    sessionId: "session-1",
    reactionId: "reaction-1",
    given: [trigger],
    messages: [
      { role: "user", content: [{ type: "text", text: "## Context\n\ncurrent-context\nprevious-context" }] },
      { role: "user", content: [{ type: "text", text: "## Event\n\nevt-trigger" }] },
      { role: "user", content: [{ type: "text", text: "## Current reaction\n\nChoose the approved supplier." }] },
    ] as any,
    instruction: "Choose the approved supplier.",
    actions,
    sandbox,
    workspaceRoot: sandbox?.workspaceRoot,
  }
}

describe("codexEngine", () => {
  it("exposes only the Reaction engine API", () => {
    expect(Object.keys(publicApi).sort()).toEqual(["CodexEngine", "codexEngine"])
  })

  it("round-trips its configuration through Workflow serde", () => {
    const engine = codexEngine({
      auth: { source: "preinstalled", codexHome: "/workspace/.codex" },
      installCodexCli: false,
      model: "gpt-5.5",
      repoPath: "/workspace/repository",
    })
    const serialized = (CodexEngine as any)[WORKFLOW_SERIALIZE](engine)
    const restored = (CodexEngine as any)[WORKFLOW_DESERIALIZE](serialized)

    expect(serialized).toEqual({ config: engine.config })
    expect(restored).toBeInstanceOf(CodexEngine)
    expect(restored.config).toEqual(engine.config)
  })

  it("writes the Reactor model messages in causal order", async () => {
    const { session, files } = fakeSandbox()
    await codexEngine({ auth: { source: "preinstalled" }, installCodexCli: false })
      .agent(agentInput(session))

    const instructionFile = files.find(file => file.path.includes("instruction-"))
    const instruction = fileText(instructionFile!)
    const contextAt = instruction.indexOf("current-context")
    const eventAt = instruction.indexOf("evt-trigger")
    const currentAt = instruction.indexOf("Choose the approved supplier.")

    expect(instruction.startsWith("## Context")).toBe(true)
    expect(eventAt).toBeGreaterThan(contextAt)
    expect(currentAt).toBeGreaterThan(eventAt)
    expect(instruction).toContain('"sessionId": "session-1"')
    expect(instruction).toContain('"reactionId": "reaction-1"')
  })

  it("executes dynamic actions and returns observable action parts", async () => {
    const runnerResults = [
      {
        status: "action_required",
        providerContextId: "thread-1",
        turnId: "turn-1",
        assistantText: "",
        reasoningText: "",
        diff: "",
        usage: {},
        action: {
          requestId: "rpc-action-1",
          callId: "call-1",
          name: "supplier.lookup",
          input: { supplierId: "supplier-7" },
        },
      },
      completedTurn(JSON.stringify({ selected: "supplier-7" })),
    ]
    const { session, files, commands } = fakeSandbox(index => runnerResults[index]!)
    const receivedInputs: unknown[] = []
    const result = await codexEngine({
      auth: { source: "preinstalled" },
      installCodexCli: false,
    }).agent(agentInput(session, {
      "supplier.lookup": {
        description: "Load a supplier by canonical id.",
        input: z.object({ supplierId: z.string() }),
        output: z.object({ found: z.boolean(), supplier: z.object({ supplierId: z.string() }) }),
        async execute(input) {
          receivedInputs.push(input)
          return { found: true, supplier: input }
        },
      },
    }))

    expect(result.output).toBe(JSON.stringify({ selected: "supplier-7" }))
    expect(receivedInputs).toEqual([{ supplierId: "supplier-7" }])
    expect(result.parts).toEqual([
      expect.objectContaining({
        type: "action",
        content: expect.objectContaining({ status: "started", actionName: "supplier.lookup" }),
      }),
      expect.objectContaining({
        type: "action",
        content: expect.objectContaining({ status: "completed", actionName: "supplier.lookup" }),
      }),
    ])
    const toolsFile = files.find(file => file.path.includes("tools-"))
    expect(JSON.parse(fileText(toolsFile!))[0]).toMatchObject({
      name: "supplier.lookup",
      inputSchema: { type: "object" },
    })
    const responseFile = files.find(file => /[/\\]action-/.test(file.path))
    expect(JSON.parse(fileText(responseFile!)).result.success).toBe(true)
    expect(commands.filter(command => command.args?.join(" ").includes("codex-turn-runner")))
      .toHaveLength(2)
  })

  it("parses structured output and requires a sandbox", async () => {
    const { session } = fakeSandbox()
    const input = agentInput(session)
    input.output = z.object({ answer: z.string() })
    const result = await codexEngine({
      auth: { source: "preinstalled" },
      installCodexCli: false,
    }).agent(input)
    expect(result.output).toEqual({ answer: "ok" })
    expect(result.metadata).toMatchObject({ provider: "codex", turnId: "turn-1" })

    await expect(codexEngine().agent(agentInput())).rejects.toThrow(
      "codex_engine_sandbox_required",
    )
  })
})

import type { ReactionEngineInput } from "@ekairos/reactor"
import { describe, expect, it, vi } from "vitest"

import { ClaudeEngine, claudeEngine } from "./index.js"

function agentInput(overrides: Partial<ReactionEngineInput> = {}): ReactionEngineInput {
  return {
    reactionKey: "test.claude",
    runtime: {} as ReactionEngineInput["runtime"],
    context: {
      ref: { id: "ctx-1", key: "ctx:test" },
      content: { customer: "acme" },
      previous: undefined,
    },
    trigger: {
      id: "evt-1",
      type: "request.received",
      channel: "test",
      createdAt: "2026-07-14T00:00:00.000Z",
      status: "stored",
      content: {},
    } as ReactionEngineInput["trigger"],
    sessionId: "session-1",
    reactionId: "reaction-1",
    given: [],
    messages: [],
    instruction: "Answer the request.",
    sandbox: { id: "sandbox-1" } as ReactionEngineInput["sandbox"],
    workspaceRoot: "/workspace",
    actions: {},
    ...overrides,
  }
}

describe("claudeEngine", () => {
  it("implements ReactionEngine and forwards the agent contract", async () => {
    const executeTurn = vi.fn(async () => ({ text: "done" }))
    const engine = claudeEngine({ executeTurn })
    const input = agentInput()

    await expect(engine.agent(input)).resolves.toEqual({
      output: "done",
      metadata: { provider: "claude" },
    })
    expect(engine).toBeInstanceOf(ClaudeEngine)
    expect(executeTurn).toHaveBeenCalledWith(input)
  })

  it("returns parsed structured output", async () => {
    const engine = claudeEngine({
      executeTurn: async () => ({ text: "{\"answer\":\"ok\"}" }),
    })

    await expect(engine.agent(agentInput({
      output: {} as ReactionEngineInput["output"],
    }))).resolves.toEqual({
      output: { answer: "ok" },
      metadata: { provider: "claude" },
    })
  })

  it("fails explicitly before calling Claude when actions are provided", async () => {
    const executeTurn = vi.fn(async () => ({ text: "unused" }))
    const engine = claudeEngine({ executeTurn })

    await expect(engine.agent(agentInput({
      actions: {
        "orders.create": {
          input: {} as any,
          output: {} as any,
          execute: async () => ({ id: "order-1" }),
        },
      },
    }))).rejects.toThrow("claude_engine_actions_not_supported")
    expect(executeTurn).not.toHaveBeenCalled()
  })
})

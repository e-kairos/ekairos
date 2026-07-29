/* @vitest-environment node */

import type { ContextEvent } from "@ekairos/events"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  runReactionEngineAgent,
} from "../agent-repair.js"
import type {
  ReactionAgentEffectDraft,
} from "../agent.js"
import type {
  ReactionEngine,
  ReactionEngineInput,
} from "../reactor.js"

const outputSchema = z.object({
  mode: z.literal("analyze"),
  plays: z.array(z.string()).min(1),
})

describe("shared Agent wire repair", () => {
  it.each([1, 2])("repairs %i invalid structured outputs before succeeding", async failures => {
    const outputs = [
      ...Array.from({ length: failures }, () => ({
        mode: "analyze",
        windows: ["20-30"],
      })),
      { mode: "analyze", plays: ["20-30"] },
    ]
    const engine = new ScriptedEngine(outputs)
    const result = await runReactionEngineAgent({
      engine,
      request: request({ output: outputSchema }),
      effects: journal(),
    })

    expect(result.output).toEqual({ mode: "analyze", plays: ["20-30"] })
    expect(engine.calls).toBe(failures + 1)
    expect(engine.lastMessages).toContain("Expected JSON Schema")
    expect(engine.lastMessages).toContain("plays")
  })

  it("throws a bounded diagnostic with the last validation and response", async () => {
    const engine = new ScriptedEngine([
      { mode: "analyze", windows: ["first"] },
      { mode: "analyze", windows: ["last-window"] },
    ])

    await expect(runReactionEngineAgent({
      engine,
      request: request({ output: outputSchema, repairRetries: 1 }),
      effects: journal(),
    })).rejects.toThrow(
      /reaction_agent_repair_exhausted:repairs=1\/1:lastValidation=.*plays.*lastResponse=.*last-window/s,
    )
    expect(engine.calls).toBe(2)
  })

  it("repairs an empty custom-engine response", async () => {
    const engine = new ScriptedEngine(["", "grounded answer"])
    const result = await runReactionEngineAgent({
      engine,
      request: request(),
      effects: journal(),
    })

    expect(result.output).toBe("grounded answer")
    expect(engine.calls).toBe(2)
    expect(engine.lastMessages).toContain("reaction_engine_empty_response")
  })

  it("truncates the last model response in exhausted diagnostics", async () => {
    const oversized = "x".repeat(5_000)
    const engine = new ScriptedEngine([
      { mode: "analyze", windows: [oversized] },
    ])

    await expect(runReactionEngineAgent({
      engine,
      request: request({ output: outputSchema, repairRetries: 0 }),
      effects: journal(),
    })).rejects.toThrow(/\[truncated\]$/)
  })
})

class ScriptedEngine implements ReactionEngine {
  calls = 0
  lastMessages = ""

  constructor(private readonly outputs: readonly unknown[]) {}

  async agent<TOutput>(input: ReactionEngineInput<unknown, TOutput>) {
    this.lastMessages = input.messages
      .map(message => JSON.stringify(message.content))
      .join("\n")
    const output = this.outputs[this.calls++]
    return { output: output as TOutput }
  }
}

function request(input: {
  output?: z.ZodType<any>
  repairRetries?: number
} = {}): ReactionEngineInput {
  return {
    reactionKey: "wire.repair",
    runtime: {} as any,
    context: { ref: { id: "context-1", key: null }, content: {} },
    trigger: {
      id: "trigger-1",
      type: "wire.requested",
      createdAt: new Date(),
      payload: {},
      links: {},
      physicalLinks: {},
      metadata: {},
      eventParts: [],
    },
    sessionId: "session-1",
    reactionId: "reaction-1",
    given: [],
    messages: [],
    instruction: "Return the requested result.",
    ...(input.output ? { output: input.output } : {}),
    ...(input.repairRetries === undefined
      ? {}
      : { repairRetries: input.repairRetries }),
    actions: {},
  }
}

function journal() {
  const drafts: ReactionAgentEffectDraft[] = []
  return {
    id: (key: string) => `event:${key}`,
    async record(draft: ReactionAgentEffectDraft) {
      drafts.push(draft)
      return {
        id: draft.id,
        type: draft.type,
        createdAt: new Date(),
        payload: draft.payload,
        links: {},
        physicalLinks: {},
        metadata: draft.metadata,
        eventParts: draft.parts.map((part, index) => ({
          id: `${draft.id}:${index}`,
          key: `${draft.id}:${index}`,
          index,
          type: part.type,
          content: part.content,
          createdAt: new Date(),
        })),
      } satisfies ContextEvent
    },
  }
}

/* @vitest-environment node */

import type { ContextEvent } from "@ekairos/events"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const model = vi.hoisted(() => ({
  turns: [] as Array<
    | { kind: "empty" }
    | { kind: "respond"; input: unknown }
    | { kind: "action"; input: unknown }
  >,
  calls: 0,
}))

vi.mock("ai", () => ({
  gateway: (id: string) => ({ id }),
  jsonSchema: (schema: unknown) => schema,
  stepCountIs: (count: number) => ({ count }),
  streamText: (input: any) => {
    const turn = model.turns[model.calls++]!
    const actionName = Object.keys(input.tools)
      .find(name => name !== "respond")
    const toolCalls = turn.kind === "empty"
      ? [{}]
      : turn.kind === "respond"
        ? [{
            toolCallId: `respond-${model.calls}`,
            toolName: "respond",
            input: turn.input,
          }]
        : [{
            toolCallId: `action-${model.calls}`,
            toolName: actionName,
            input: turn.input,
          }]
    return {
      text: Promise.resolve(""),
      toolCalls: Promise.resolve(toolCalls),
      usage: Promise.resolve(undefined),
      providerMetadata: Promise.resolve(undefined),
    }
  },
}))

import { runReactionEngineAgent } from "../agent-repair.js"
import type { ReactionAgentEffectDraft } from "../agent.js"

const output = z.object({ answer: z.string().min(1) })

describe("AI SDK Agent wire repair", () => {
  beforeEach(() => {
    model.calls = 0
    model.turns = []
  })

  it("repairs an empty/malformed tool call", async () => {
    model.turns = [
      { kind: "empty" },
      { kind: "respond", input: { answer: "repaired" } },
    ]

    const result = await runReactionEngineAgent({
      engine: { kind: "ekairos.ai", model: "test/model" },
      request: request(),
      effects: journal(),
    })

    expect(result.output).toEqual({ answer: "repaired" })
    expect(model.calls).toBe(2)
  })

  it("repairs an invalid RESPOND input", async () => {
    model.turns = [
      { kind: "respond", input: {} },
      { kind: "respond", input: { answer: "valid" } },
    ]

    const result = await runReactionEngineAgent({
      engine: { kind: "ekairos.ai", model: "test/model" },
      request: request(),
      effects: journal(),
    })

    expect(result.output).toEqual({ answer: "valid" })
    expect(model.calls).toBe(2)
  })

  it("feeds an invalid action input back to the model without crashing", async () => {
    model.turns = [
      { kind: "action", input: { count: "two" } },
      { kind: "respond", input: { answer: "corrected after tool error" } },
    ]
    const actionInput = z.object({ count: z.number().int() })
    const executed: unknown[] = []

    const result = await runReactionEngineAgent({
      engine: { kind: "ekairos.ai", model: "test/model" },
      request: request({
        actions: {
          "catalog.lookup": {
            input: actionInput,
            output: z.object({ ok: z.boolean() }),
            async execute(value) {
              const parsed = actionInput.parse(value)
              executed.push(parsed)
              return { ok: true }
            },
          },
        },
      }),
      effects: journal(),
    })

    expect(result.output).toEqual({ answer: "corrected after tool error" })
    expect(executed).toEqual([])
    expect(model.calls).toBe(2)
  })
})

function request(overrides: { actions?: Record<string, any> } = {}) {
  return {
    reactionKey: "wire.ai-sdk",
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
    causeIds: [],
    events: [],
    messages: [],
    instruction: "Return the requested answer.",
    output,
    maxRounds: 4,
    repairRetries: 2,
    actions: overrides.actions ?? {},
  }
}

function journal() {
  return {
    id: (key: string) => `event:${key}`,
    async record(draft: ReactionAgentEffectDraft) {
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

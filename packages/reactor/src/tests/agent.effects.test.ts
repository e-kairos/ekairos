/* @vitest-environment node */

import { Part, type ContextEvent } from "@ekairos/events"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const rounds = vi.hoisted(() => ({ value: 0 }))

vi.mock("../reactors/ai-sdk.agent.js", () => ({
  executeAiSdkAgentRound: vi.fn(async (input: any) => {
    const round = rounds.value++
    if (round === 0) {
      const actionName = Object.keys(input.actions).find(name => name !== "respond")!
      return {
        text: "",
        calls: [{ actionCallId: "call-1", actionName, input: { sku: "A-1" } }],
        parts: [{
          type: "action",
          content: {
            status: "started",
            actionName,
            actionCallId: "call-1",
            input: { sku: "A-1" },
          },
        }],
        metadata: { round },
      }
    }
    return {
      text: "Found A-1.",
      calls: [],
      parts: [Part.message("Found A-1.")],
      metadata: { round },
    }
  }),
}))

import {
  runReactionEngineAgent,
  type ReactionAgentEffectDraft,
} from "../agent.js"

describe("agent Reaction effects", () => {
  beforeEach(() => { rounds.value = 0 })

  it("records every model call and action execution as ordered Events", async () => {
    const drafts: ReactionAgentEffectDraft[] = []
    const executions: unknown[] = []
    const result = await runReactionEngineAgent({
      engine: { kind: "ekairos.ai", model: "test/model" },
      request: {
        reactionKey: "catalog.answer",
        runtime: {} as any,
        context: { ref: { id: "context-1", key: null }, content: {} },
        trigger: {
          id: "trigger-1",
          type: "catalog.requested",
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
        instruction: "Find the SKU and answer.",
        actions: {
          "catalog.find": {
            input: z.object({ sku: z.string() }),
            output: z.object({ found: z.boolean() }),
            async execute(_input, reactionId) {
              executions.push(reactionId)
              return { found: true }
            },
          },
        },
      },
      effects: {
        id: key => `event:${key}`,
        async record(draft) {
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
      },
    })

    expect(drafts.map(draft => draft.type)).toEqual([
      "context.model",
      "context.action",
      "context.model",
    ])
    expect(drafts.map(draft => draft.id)).toEqual([
      "event:model:0",
      "event:action:0:0",
      "event:model:1",
    ])
    expect(executions).toEqual(["reaction-1"])
    expect(result.event.id).toBe("event:model:1")
    expect(result.output).toBe("Found A-1.")
  })
})

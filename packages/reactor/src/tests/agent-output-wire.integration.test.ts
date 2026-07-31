/* @vitest-environment node */

import type { ContextEvent } from "@ekairos/events"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const aiSdk = vi.hoisted(() => ({
  rounds: 0,
  toolSchemas: [] as Array<Record<string, any>>,
}))

vi.mock("ai", () => ({
  gateway: (model: string) => ({ model }),
  jsonSchema: (schema: unknown) => schema,
  stepCountIs: (count: number) => ({ count }),
  streamText: (input: any) => {
    aiSdk.toolSchemas.push(input.tools)
    const round = aiSdk.rounds++
    const actionName = Object.keys(input.tools).find(name => name !== "respond")
    return {
      text: Promise.resolve(""),
      toolCalls: Promise.resolve(round === 0
        ? [{
            toolCallId: "call-action",
            toolName: actionName,
            input: { result: "A-1" },
          }]
        : [{
            toolCallId: "call-respond",
            toolName: "respond",
            input: { result: { mode: "chat", reply: "Encontrado." } },
          }]),
      usage: Promise.resolve(undefined),
      providerMetadata: Promise.resolve(undefined),
    }
  },
}))

import {
  runReactionEngineAgent,
  type ReactionAgentEffectDraft,
} from "../agent.js"

describe("agent output wire integration", () => {
  beforeEach(() => {
    aiSdk.rounds = 0
    aiSdk.toolSchemas = []
  })

  it("keeps action inputs, outputs, and persisted Events free of wire envelopes", async () => {
    const drafts: ReactionAgentEffectDraft[] = []
    const actionInputs: unknown[] = []
    const output = z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("chat"), reply: z.string() }),
      z.object({ mode: z.literal("analyze"), plays: z.array(z.string()) }),
    ])

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
        causeIds: [],
        events: [],
        messages: [],
        instruction: "Find the SKU and answer.",
        output,
        actions: {
          "catalog.find": {
            input: z.string(),
            output: z.object({ found: z.boolean() }),
            async execute(input) {
              actionInputs.push(input)
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

    const firstRoundTools = aiSdk.toolSchemas[0]!
    expect(firstRoundTools.respond.inputSchema.type).toBe("object")
    expect(firstRoundTools.respond.inputSchema.required).toEqual(["result"])
    const actionTool = Object.entries(firstRoundTools)
      .find(([name]) => name !== "respond")![1]
    expect(actionTool.inputSchema.type).toBe("object")
    expect(actionTool.inputSchema.required).toEqual(["result"])

    expect(actionInputs).toEqual(["A-1"])
    expect(result.output).toEqual({ mode: "chat", reply: "Encontrado." })
    expect(result.event.payload).toEqual({ mode: "chat", reply: "Encontrado." })
    expect(drafts.map(draft => draft.payload)).toEqual([
      {
        round: 0,
        text: "",
        actionCalls: [{
          actionCallId: "call-action",
          actionName: "catalog.find",
          input: "A-1",
        }],
      },
      { found: true },
      { mode: "chat", reply: "Encontrado." },
    ])
  })
})

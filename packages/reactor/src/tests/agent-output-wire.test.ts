/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  actionSpecToAiSdkTool,
  actionsToActionSpecs,
  decodeActionSpecInput,
  normalizeRespondToolInput,
} from "../tools-to-model-tools.js"

describe("agent tool wire normalization", () => {
  it("wraps and unwraps non-object root schemas invisibly", () => {
    const output = z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("chat"), reply: z.string() }),
      z.object({ mode: z.literal("analyze"), plays: z.array(z.string()) }),
    ])
    const spec = actionsToActionSpecs({
      respond: { input: output, output, async execute(value: unknown) { return value } },
    }).respond!
    const tool = actionSpecToAiSdkTool("respond", spec, schema => schema)

    expect(tool.inputSchema).toMatchObject({
      type: "object",
      required: ["result"],
      additionalProperties: false,
      properties: {
        result: expect.objectContaining({ oneOf: expect.any(Array) }),
      },
    })
    expect(tool.description).toContain('"result" field')
    expect(decodeActionSpecInput(spec, {
      result: { mode: "chat", reply: "Hola" },
    })).toEqual({ mode: "chat", reply: "Hola" })
  })

  it("leaves object-root schemas intact", () => {
    const inputSchema = {
      type: "object",
      properties: { sku: { type: "string" } },
      required: ["sku"],
    }
    const spec = {
      type: "function" as const,
      description: "Find a SKU.",
      inputSchema,
    }
    const tool = actionSpecToAiSdkTool("find", spec, schema => schema)
    const input = { sku: "A-1" }

    expect(tool.inputSchema).toBe(inputSchema)
    expect(tool.description).toBe("Find a SKU.")
    expect(decodeActionSpecInput(spec, input)).toBe(input)
  })

  it("accepts JSON strings for structured RESPOND values after normal parsing fails", () => {
    const decision = z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("chat"), reply: z.string() }),
      z.object({ mode: z.literal("analyze"), plays: z.array(z.string()) }),
    ])

    expect(normalizeRespondToolInput(
      decision,
      JSON.stringify({ mode: "chat", reply: "Hola" }),
    )).toEqual({ mode: "chat", reply: "Hola" })

    expect(normalizeRespondToolInput(
      z.object({ decision }),
      { decision: JSON.stringify({ mode: "analyze", plays: ["goal"] }) },
    )).toEqual({
      decision: { mode: "analyze", plays: ["goal"] },
    })

    expect(normalizeRespondToolInput(
      z.array(z.object({ id: z.number() })),
      JSON.stringify([{ id: 1 }]),
    )).toEqual([{ id: 1 }])
  })

  it("keeps the normal schema error when the JSON fallback is still invalid", () => {
    const schema = z.object({ count: z.number() })
    expect(() => normalizeRespondToolInput(
      schema,
      { count: JSON.stringify("not-a-number") },
    )).toThrow()
  })
})

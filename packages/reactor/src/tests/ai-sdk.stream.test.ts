/* @vitest-environment node */

import { describe, expect, it } from "vitest"

import { mapAiSdkStreamChunk } from "../reactors/ai-sdk.stream.js"

describe("AI SDK Reaction stream mapping", () => {
  it("maps content and action chunks without leaking provider semantics into the reader", () => {
    expect(mapAiSdkStreamChunk({
      type: "text-delta",
      id: "text-1",
      text: "hello",
    }, 2)).toMatchObject({
      kind: "text.delta",
      round: 2,
      partId: "text-1",
      delta: "hello",
      provider: "ai-sdk",
      providerType: "text-delta",
    })
    expect(mapAiSdkStreamChunk({
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "catalog_find",
      input: { sku: "A-1" },
    }, 2)).toMatchObject({
      kind: "action.started",
      round: 2,
      actionCallId: "call-1",
      actionName: "catalog_find",
      input: { sku: "A-1" },
    })
  })
})

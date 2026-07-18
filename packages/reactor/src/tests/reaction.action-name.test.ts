import { describe, expect, it } from "vitest"

import { toModelActionName } from "../action-name.js"
import { actionPartsToModelMessages } from "../reaction-view.js"

describe("Reaction action names at the model boundary", () => {
  it("preserves valid names and deterministically encodes canonical domain actions", () => {
    expect(toModelActionName("catalog_find")).toBe("catalog_find")

    const encoded = toModelActionName("workbench.review.record")
    expect(encoded).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(encoded).toBe(toModelActionName("workbench.review.record"))
    expect(encoded).not.toBe(toModelActionName("workbench_review_record"))
    expect(encoded.length).toBeLessThanOrEqual(64)
  })

  it("encodes replayed durable action parts before sending them to the model", () => {
    const messages = actionPartsToModelMessages([
      {
        type: "action",
        content: {
          status: "started",
          actionName: "workbench.review.record",
          actionCallId: "call-1",
          input: { reviewId: "review-1" },
        },
      },
      {
        type: "action",
        content: {
          status: "completed",
          actionName: "workbench.review.record",
          actionCallId: "call-1",
          output: { ok: true },
        },
      },
    ]) as any[]

    const assistantName = (messages[0] as any).content[0].toolName
    const resultName = (messages[1] as any).content[0].toolName
    expect(assistantName).toBe(toModelActionName("workbench.review.record"))
    expect(resultName).toBe(assistantName)
  })
})

import { describe, expect, it } from "vitest"

import { buildAgentModelMessages } from "../reaction-view.ts"

describe("Reaction model view", () => {
  it("orders stable Context, one message per selected Event, then the current instruction", async () => {
    const runtime: any = {
      async db() {
        return {
          async query() {
            return {
              $files: [{
                id: "file-1",
                path: "quote.pdf",
                url: "https://example.test/quote.pdf",
                "content-type": "application/pdf",
                size: 42,
              }],
            }
          },
        }
      },
    }
    const event: any = {
      id: "event-1",
      type: "requisition.messageReceived",
      domain: "requisition",
      name: "messageReceived",
      channel: "email",
      createdAt: new Date("2026-07-16T12:00:00.000Z"),
      payload: { message: "Cotizar" },
      metadata: { deliveryId: "mail-1" },
      links: { files: ["file-1"] },
      physicalLinks: { files: { target: "$files" } },
      eventParts: [],
    }
    const messages: any[] = await buildAgentModelMessages({
      runtime,
      reactionKey: "award.answer",
      instruction: "Answer with facts.",
      context: {
        ref: { id: "context-1", key: "requisition:1" },
        content: { requisitionId: "REQ-1", version: 3 },
      },
      events: [event],
    })

    expect(messages).toHaveLength(3)
    expect(messages[0].content[0].text).toContain("## Context")
    expect(messages[0].content[0].text).toContain('"version": 3')
    expect(messages[1].content[0].text).toContain("## Event")
    expect(messages[1].content[0].text).toContain('"deliveryId": "mail-1"')
    expect(messages[1].content.some((part: any) =>
      part.type === "text" && part.text.includes('"fileId": "file-1"'))).toBe(true)
    expect(messages[1].content.some((part: any) => part.type === "file")).toBe(true)
    expect(messages[2].content[0].text).toContain("Answer with facts.")
  })

  it("projects linked text files as text instead of unsupported file parts", async () => {
    const runtime: any = {
      async db() {
        return {
          async query() {
            return {
              $files: [{
                id: "file-markdown",
                path: "request.md",
                url: "data:text/markdown;base64,IyBSZXF1ZXN0CgotIDEyIG5vdGVib29rcw==",
                "content-type": "text/markdown",
                size: 25,
              }],
            }
          },
        }
      },
    }
    const event: any = {
      id: "event-text",
      type: "requisition.messageReceived",
      domain: "requisition",
      name: "messageReceived",
      channel: "email",
      createdAt: new Date("2026-07-16T12:00:00.000Z"),
      payload: { message: "Review" },
      metadata: {},
      links: { files: ["file-markdown"] },
      physicalLinks: { files: { target: "$files" } },
      eventParts: [],
    }

    const messages: any[] = await buildAgentModelMessages({
      runtime,
      reactionKey: "award.review",
      instruction: "Extract items.",
      context: {
        ref: { id: "context-1", key: "requisition:1" },
        content: { requisitionId: "REQ-1" },
      },
      events: [event],
    })

    expect(messages[1].content.some((part: any) => part.type === "file")).toBe(false)
    expect(messages[1].content.some((part: any) =>
      part.type === "text" && part.text.includes("12 notebooks"))).toBe(true)
    expect(messages[1].content.some((part: any) =>
      part.type === "text" && part.text.includes('"fileId": "file-markdown"'))).toBe(true)
  })
})

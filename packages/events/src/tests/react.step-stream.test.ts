import { describe, expect, it } from "vitest"

import { buildLiveEventFromStepChunks } from "../react.step-stream.js"

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

describe("react step stream", () => {
  it("preserves nested Codex dynamic action identity in live events", () => {
    const actionCallId = "call_read_dataset_rows_001"
    const callEvent = {
      method: "item/tool/call",
      params: {
        threadId: "thr-live",
        turnId: "turn-live-001",
        item: {
          id: actionCallId,
          type: "toolCall",
          name: "read_dataset_rows",
          arguments: "{\"datasetId\":\"ds-001\",\"limit\":3}",
        },
      },
    }
    const resultEvent = {
      method: "item/tool/result",
      params: {
        threadId: "thr-live",
        turnId: "turn-live-001",
        item: {
          id: actionCallId,
          type: "toolCall",
          name: "read_dataset_rows",
        },
        result: {
          success: true,
          contentItems: [
            {
              type: "inputText",
              text: "{\"rows\":[{\"id\":\"row-001\"}],\"done\":true}",
            },
          ],
        },
      },
    }

    const event = buildLiveEventFromStepChunks({
      eventId: "evt-live",
      createdAt: "2026-02-20T00:00:00.000Z",
      chunks: [
        {
          sequence: 1,
          chunkType: "chunk.action_started",
          provider: "codex",
          actionRef: actionCallId,
          data: {
            method: callEvent.method,
            params: callEvent.params,
          },
          raw: callEvent,
        },
        {
          sequence: 2,
          chunkType: "chunk.action_completed",
          provider: "codex",
          actionRef: actionCallId,
          data: {
            method: resultEvent.method,
            params: resultEvent.params,
          },
          raw: resultEvent,
        },
        {
          sequence: 3,
          chunkType: "chunk.finish",
          provider: "codex",
        },
      ],
    })

    const parts = Array.isArray(event.content?.parts)
      ? event.content.parts.map((part) => asRecord(part))
      : []
    const actionParts = parts.filter((part) => {
      const content = asRecord(part.content)
      return asRecord(part).type === "action" && content.actionCallId === actionCallId
    })
    const started = actionParts.find(
      (part) => asRecord(part.content).status === "started",
    )
    const completed = actionParts.find(
      (part) => asRecord(part.content).status === "completed",
    )
    const startedContent = asRecord(started?.content)
    const completedContent = asRecord(completed?.content)

    expect(actionParts).toHaveLength(2)
    expect(startedContent.actionName).toBe("read_dataset_rows")
    expect(completedContent.actionName).toBe("read_dataset_rows")
    expect(startedContent.actionName).not.toBe("call")
    expect(completedContent.actionName).not.toBe("result")
    expect(startedContent.input).toMatchObject({ datasetId: "ds-001", limit: 3 })
    expect(completedContent.output).toMatchObject({
      rows: [{ id: "row-001" }],
      done: true,
    })
  })
})

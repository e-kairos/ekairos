/* @vitest-environment node */

import { describe, expect, it } from "vitest"

import {
  consumeReactionStream,
  createReactionStreamChunk,
  encodeReactionStreamChunk,
  parseReactionStreamChunk,
  reduceReactionStream,
} from "../context.reaction-stream.js"

describe("Reaction stream protocol", () => {
  it("encodes validated NDJSON and rejects invalid sequence numbers", () => {
    const chunk = createReactionStreamChunk({
      reactionId: "reaction-1",
      sequence: 1,
      kind: "reaction.started",
      at: "2026-07-16T12:00:00.000Z",
    })

    const encoded = encodeReactionStreamChunk(chunk)
    expect(encoded.endsWith("\n")).toBe(true)
    expect(parseReactionStreamChunk(encoded.trim())).toEqual(chunk)
    expect(() => createReactionStreamChunk({
      reactionId: "reaction-1",
      sequence: 0,
      kind: "reaction.started",
    })).toThrow("sequence")
  })

  it("reduces one Reaction stream into ordered provisional model and action Events", () => {
    const common = { reactionId: "reaction-1" }
    const chunks = [
      createReactionStreamChunk({
        ...common,
        sequence: 1,
        kind: "reaction.started",
        at: "2026-07-16T12:00:00.000Z",
      }),
      createReactionStreamChunk({
        ...common,
        eventId: "model-0",
        sequence: 2,
        kind: "model.round.started",
        round: 0,
        data: { eventType: "context.model", channel: "web" },
      }),
      createReactionStreamChunk({
        ...common,
        eventId: "model-0",
        sequence: 3,
        kind: "reasoning.delta",
        round: 0,
        partId: "reasoning-1",
        delta: "Check facts. ",
      }),
      createReactionStreamChunk({
        ...common,
        eventId: "model-0",
        sequence: 4,
        kind: "text.delta",
        round: 0,
        partId: "text-1",
        delta: "Hello ",
      }),
      createReactionStreamChunk({
        ...common,
        eventId: "model-0",
        sequence: 5,
        kind: "text.delta",
        round: 0,
        partId: "text-1",
        delta: "world",
      }),
      createReactionStreamChunk({
        ...common,
        eventId: "model-0",
        sequence: 6,
        kind: "model.round.completed",
        round: 0,
      }),
      createReactionStreamChunk({
        ...common,
        eventId: "action-0",
        sequence: 7,
        kind: "action.started",
        round: 0,
        actionCallId: "call-1",
        actionName: "catalog.find",
        input: { sku: "A-1" },
      }),
      createReactionStreamChunk({
        ...common,
        eventId: "action-0",
        sequence: 8,
        kind: "action.completed",
        round: 0,
        actionCallId: "call-1",
        actionName: "catalog.find",
        output: { found: true },
      }),
      createReactionStreamChunk({
        ...common,
        sequence: 9,
        kind: "reaction.completed",
      }),
    ]

    const result = reduceReactionStream(chunks)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      reactionId: "reaction-1",
      eventId: "model-0",
      eventType: "context.model",
      channel: "web",
      status: "completed",
      lastSequence: 6,
    })
    expect(result[0]!.parts).toEqual([
      {
        type: "reasoning",
        content: { text: "Check facts. ", state: "done" },
      },
      {
        type: "message",
        content: { text: "Hello world" },
      },
    ])
    expect(result[1]).toMatchObject({
      reactionId: "reaction-1",
      eventId: "action-0",
      eventType: "context.action",
      status: "completed",
      lastSequence: 8,
    })
    expect(result[1]!.parts).toEqual([
      {
        type: "action",
        content: {
          status: "started",
          actionName: "catalog.find",
          actionCallId: "call-1",
          input: { sku: "A-1" },
        },
      },
      {
        type: "action",
        content: {
          status: "completed",
          actionName: "catalog.find",
          actionCallId: "call-1",
          output: { found: true },
        },
      },
    ])
  })

  it("resumes from a byte offset and parses chunks split across stream reads", async () => {
    const first = encodeReactionStreamChunk(createReactionStreamChunk({
      reactionId: "reaction-1",
      sequence: 1,
      kind: "reaction.started",
    }))
    const second = encodeReactionStreamChunk(createReactionStreamChunk({
      reactionId: "reaction-1",
      eventId: "model-0",
      sequence: 2,
      kind: "text.delta",
      delta: "streamed",
    }))
    const bytes = new TextEncoder().encode(first + second)
    const calls: any[] = []
    const db = {
      streams: {
        createReadStream(options: any) {
          calls.push(options)
          const remaining = bytes.slice(options.byteOffset ?? 0)
          return new ReadableStream<Uint8Array>({
            start(controller) {
              const pivot = Math.max(1, Math.floor(remaining.length / 2))
              controller.enqueue(remaining.slice(0, pivot))
              controller.enqueue(remaining.slice(pivot))
              controller.close()
            },
          })
        },
      },
    }
    const chunks: any[] = []
    const offsets: number[] = []
    await consumeReactionStream({
      db,
      streamId: "stream-1",
      clientId: "context-reaction:reaction-1",
      byteOffset: new TextEncoder().encode(first).length,
      signal: new AbortController().signal,
      onChunk: chunk => { chunks.push(chunk) },
      onByteOffset: offset => { offsets.push(offset) },
    })

    expect(calls).toEqual([{
      streamId: "stream-1",
      clientId: "context-reaction:reaction-1",
      byteOffset: new TextEncoder().encode(first).length,
    }])
    expect(chunks.map(chunk => chunk.sequence)).toEqual([2])
    expect(offsets[offsets.length - 1]).toBe(bytes.length)
  })
})

/* @vitest-environment node */

import { Part } from "@ekairos/events"
import { describe, expect, it } from "vitest"

import type {
  ReactionEngineInput,
  ReactionEngineStreamEmission,
} from "../reactor.js"
import {
  scripted,
  type ScriptedAgentInput,
  type ScriptedStreamEmission,
} from "../reactors/scripted.js"

describe("scripted ReactionEngine", () => {
  it("receives the complete contextual input and returns durable result material", async () => {
    let observed: ScriptedAgentInput<{ customerTier: string }> | undefined
    const engine = scripted<{ customerTier: string }>({
      agent(input) {
        observed = input
        const text = `${input.trigger.type}:${input.context.content.customerTier}`
        return {
          output: { text },
          parts: [Part.message(text)],
          metadata: { case: "contextual" },
        }
      },
    })
    const input = request({ sessionId: "session-context" })
    const result = await engine.agent(input)

    expect(observed).not.toBe(input)
    expect(observed?.trigger).toBe(input.trigger)
    expect(observed).toMatchObject({
      sessionId: "session-context",
      reactionId: "reaction-1",
      causeIds: ["cause-1", "cause-2"],
      instruction: "Classify the request.",
      context: {
        ref: { id: "context-1", key: "customer:42" },
        content: { customerTier: "critical" },
        previous: { customerTier: "standard" },
      },
    })
    expect(observed?.events).toHaveLength(2)
    expect(observed?.messages).toHaveLength(1)
    expect(Object.keys(observed?.actions ?? {})).toEqual(["request.approve"])
    expect(result.output).toEqual({
      text: "request.received:critical",
    })
    expect(result.parts).toEqual([Part.message("request.received:critical")])
    expect(result.metadata).toEqual({ engine: "scripted", case: "contextual" })
  })

  it("emits declarative content streams in order", async () => {
    const emitted: ReactionEngineStreamEmission[] = []
    const engine = scripted({
      agent() {
        return {
          output: "hello world",
          stream: [
            { kind: "text.delta", round: 0, partId: "message:0", delta: "hello " },
            { kind: "text.delta", round: 0, partId: "message:0", delta: "world" },
          ],
        }
      },
    })

    await engine.agent(request({
      stream: {
        reactionId: "reaction-1",
        streamId: "stream-1",
        clientId: "scripted:stream-1",
        async emit(emission) {
          emitted.push(emission)
          return {} as never
        },
      },
    }))

    expect(emitted.map(emission => emission.kind)).toEqual([
      "text.delta",
      "text.delta",
    ])
    expect(emitted.map(emission => emission.delta).join("")).toBe("hello world")
  })

  it("supports asynchronous streams without shared mutable steps", async () => {
    const calls: string[] = []
    const engine = scripted({
      agent(input) {
        calls.push(input.sessionId)
        return {
          output: input.sessionId,
          stream: async function* () {
            yield {
              kind: "text.delta" as const,
              round: 0,
              partId: "message:0",
              delta: input.sessionId,
            }
          }(),
        }
      },
    })

    expect((await engine.agent(request({ sessionId: "session-a" }))).output)
      .toBe("session-a")
    expect((await engine.agent(request({ sessionId: "session-b" }))).output)
      .toBe("session-b")
    expect(calls).toEqual(["session-a", "session-b"])
  })

  it("rejects lifecycle chunks owned by the framework", async () => {
    const engine = scripted({
      agent() {
        return {
          output: "invalid lifecycle",
          stream: [{ kind: "model.round.started", round: 0 }] as unknown as ScriptedStreamEmission[],
        }
      },
    })

    await expect(engine.agent(request({
      stream: {
        reactionId: "reaction-1",
        streamId: "stream-1",
        clientId: "scripted:stream-1",
        async emit() { return {} as never },
      },
    }))).rejects.toThrow(
      "scripted_stream_kind_owned_by_framework:model.round.started",
    )
  })

  it("guards direct stream access with the same lifecycle boundary", async () => {
    const engine = scripted({
      async agent(input) {
        await input.stream?.emit({
          kind: "reaction.completed",
        } as unknown as ScriptedStreamEmission)
        return { output: "unreachable" }
      },
    })

    await expect(engine.agent(request({
      stream: {
        reactionId: "reaction-1",
        streamId: "stream-1",
        clientId: "scripted:stream-1",
        async emit() { return {} as never },
      },
    }))).rejects.toThrow(
      "scripted_stream_kind_owned_by_framework:reaction.completed",
    )
  })
})

function event(id: string, type: string, payload: unknown) {
  return {
    id,
    type,
    createdAt: new Date(),
    payload,
    links: {},
    physicalLinks: {},
    metadata: {},
    eventParts: [],
  }
}

function request(overrides: Partial<ReactionEngineInput<{
  customerTier: string
}>> = {}): ReactionEngineInput<{ customerTier: string }, any> {
  const trigger = event("trigger-1", "request.received", { amount: 120_000 })
  return {
    reactionKey: "request.classify",
    runtime: {} as any,
    context: {
      ref: { id: "context-1", key: "customer:42" },
      content: { customerTier: "critical" },
      previous: { customerTier: "standard" },
    },
    trigger,
    sessionId: "session-1",
    reactionId: "reaction-1",
    causeIds: ["cause-1", "cause-2"],
    events: [
      event("cause-1", "request.received", { amount: 120_000 }),
      event("cause-2", "customer.profileUpdated", { tier: "critical" }),
    ],
    messages: [{ role: "user", content: "Classify this request." }],
    instruction: "Classify the request.",
    actions: {
      "request.approve": {
        input: {} as any,
        output: {} as any,
        async execute() { return { approved: true } },
      },
    },
    ...overrides,
  }
}

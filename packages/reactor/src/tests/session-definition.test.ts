import { describe, expect, it } from "vitest"
import { i } from "@instantdb/core"
import { z } from "zod"

import { defineEvent, domain } from "../../../domain/src/index.ts"
import { ContextHandle } from "../../../events/src/index.ts"
import { ai } from "../reactor.ts"
import { Session } from "../session.ts"

const conversation = domain("conversationSessionTest")
  .withSchema({
    entities: {
      conversationSessionTest_messages: i.entity({
        text: i.string(),
        createdAt: i.number().indexed(),
      }),
    },
    links: {},
    rooms: {},
  })
  .withEvents({
    received: defineEvent({ payload: z.object({ text: z.string() }) }),
    closed: defineEvent({ payload: z.object({ reason: z.string() }) }),
  })
const conversationScope = conversation.scope({
  events: [conversation.events.received],
  actions: [],
})

const runtime = {
  db: async () => null,
  use: async () => null,
} as any
const context = new ContextHandle(runtime, {
  id: "context-1",
  key: "conversation-1",
  content: { policy: "durable" },
  createdAt: new Date(),
} as any)

describe("Session", () => {
  it("accepts either a gateway model id or an async AI SDK model factory", () => {
    const factory = async () => ({ provider: "test" })

    expect(ai({ model: "openai/gpt-5.2" }).model).toBe("openai/gpt-5.2")
    expect(ai({ model: factory }).model).toBe(factory)
    expect(() => ai({ model: "  " })).toThrow(
      "ai() engine requires a model id or async model factory.",
    )
  })

  it("creates one lazy, explicitly scoped execution", () => {
    const session = new Session(runtime, context, {
      scope: conversationScope,
      engine: false,
    })

    expect(session.from).toBeTypeOf("function")
    expect(session.complete).toBeTypeOf("function")
    expect(session.context).toBe(context)
    expect(session[Symbol.asyncDispose]).toBeTypeOf("function")
  })

  it("requires scope and engine while sandbox remains optional", () => {
    expect(() => new Session(runtime, context, {
      engine: false,
    } as never)).toThrow("session_scope_required")

    expect(() => new Session(runtime, context, {
      scope: conversationScope,
    } as never)).toThrow("session_engine_declaration_required")
  })

  it("rejects domain events outside the concrete scope", () => {
    const session = new Session(runtime, context, {
      scope: conversationScope,
      engine: false,
    })

    expect(session.from(conversation.events.received({ text: "hello" })))
      .toHaveProperty("agent")
    expect(() => session.from(
      conversation.events.closed({ reason: "done" }) as never,
    )).toThrow(
      "reaction_event_outside_scope:conversationSessionTest.closed",
    )
  })

  it("appends draft points in order before executing their joined operation", async () => {
    const appended: string[] = []
    const operationPoints: string[] = []
    const draftContext = new ContextHandle(runtime, {
      id: "context-drafts",
      key: "conversation-drafts",
      content: null,
      createdAt: new Date(),
    } as any)
    ;(draftContext as any).append = async (draft: any) => {
      appended.push(draft.payload.text)
      return {
        id: `event-${appended.length}`,
        type: draft.kind,
        domain: draft.domain,
        name: draft.name,
        createdAt: new Date(),
        contextId: draftContext.id,
        payload: draft.payload,
        links: {},
        physicalLinks: {},
        metadata: { causeIds: [] },
        eventParts: [],
      }
    }
    const session = new Session(runtime, draftContext, {
      scope: conversationScope,
      engine: { agent: async () => ({ output: "unused" }) },
    })
    ;(session as any).operation = async (events: any[]) => {
      operationPoints.push(...events.map(event => event.id))
      return events.at(-1)
    }

    await session.from([
      conversation.events.received({ text: "first" }),
      conversation.events.received({ text: "second" }),
    ]).agent({
      instruction: "Join both drafts.",
      datasets: false,
    })

    expect(appended).toEqual(["first", "second"])
    expect(operationPoints).toEqual(["event-1", "event-2"])
  })

  it("wires an explicit query Dataset to the scoped Domain without an engine", async () => {
    const queryContext = new ContextHandle(runtime, {
      id: "context-query",
      key: "conversation-query",
      content: null,
      createdAt: new Date(),
    } as any)
    ;(queryContext as any).append = async (draft: any) => ({
      id: "query-trigger",
      type: draft.kind,
      domain: draft.domain,
      name: draft.name,
      createdAt: new Date(),
      contextId: queryContext.id,
      payload: draft.payload,
      links: {},
      physicalLinks: {},
      metadata: { causeIds: [] },
      eventParts: [],
    })
    const session = new Session(runtime, queryContext, {
      scope: conversationScope,
      engine: false,
    })
    let captured: any
    ;(session as any).operation = async (events: any[], operation: any) => {
      captured = { events, operation }
      return events[0]
    }
    const query = {
      conversationSessionTest_messages: {
        $: { order: { createdAt: "asc" } },
      },
    } as const

    await session.from(
      conversation.events.received({ text: "important messages" }),
    ).dataset({
      title: "Important messages",
      query,
    })

    expect(captured.events.map((event: any) => event.id)).toEqual(["query-trigger"])
    expect(captured.operation).toEqual({
      kind: "dataset",
      instruction: "Important messages",
      recordSchema: undefined,
      source: {
        query,
        domain: conversationScope,
        title: "Important messages",
      },
    })
  })

  it("makes explicit completion and async disposal idempotent", async () => {
    const session = new Session(runtime, context, {
      scope: conversationScope,
      engine: false,
    })
    let completions = 0
    ;(session as any).completeNow = async () => {
      completions += 1
      ;(session as any).completed = true
    }

    await Promise.all([session.complete(), session.complete()])
    await session.complete()
    await session[Symbol.asyncDispose]()

    expect(completions).toBe(1)
  })
})

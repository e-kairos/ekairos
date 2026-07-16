import { describe, expect, it } from "vitest"
import { z } from "zod"

import { defineEvent, domain } from "../../../domain/src/index.ts"
import { ai } from "../reactor.ts"
import { defineReaction } from "../reaction.ts"

const message = defineEvent({
  payload: z.object({ text: z.string() }),
})

const conversation = domain("conversationReactionTest")
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({ message })

const unrelated = domain("unrelatedReactionTest")
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({ message })

describe("defineReaction", () => {
  it("accepts either a gateway model id or an async AI SDK model factory", () => {
    const factory = async () => ({ provider: "test" })

    expect(ai({ model: "openai/gpt-5.2" }).model).toBe("openai/gpt-5.2")
    expect(ai({ model: factory }).model).toBe(factory)
    expect(() => ai({ model: "  " })).toThrow(
      "ai() engine requires a model id or async model factory.",
    )
  })

  it("creates one immutable, explicitly configured definition", () => {
    const definition = defineReaction(
      conversation.events.message,
      {
        key: "conversation.answer",
        scope: conversation,
        engine: false,
        sandbox: false,
      },
      async () => [] as never,
    )

    expect(definition.key).toBe("conversation.answer")
    expect(definition.trigger).toBe(conversation.events.message)
    expect(definition.scope).toBe(conversation)
    expect(Object.isFrozen(definition)).toBe(true)
  })

  it("requires explicit engine and sandbox declarations", () => {
    expect(() => defineReaction(
      conversation.events.message,
      {
        key: "conversation.no-engine",
        scope: conversation,
        sandbox: false,
      } as never,
      async () => [] as never,
    )).toThrow("reaction_engine_declaration_required")

    expect(() => defineReaction(
      conversation.events.message,
      {
        key: "conversation.no-sandbox",
        scope: conversation,
        engine: false,
      } as never,
      async () => [] as never,
    )).toThrow("reaction_sandbox_declaration_required")
  })

  it("accepts a durable sandbox id or resolver without exposing a runtime handle", () => {
    const byId = defineReaction(
      conversation.events.message,
      {
        key: "conversation.by-sandbox-id",
        scope: conversation,
        engine: false,
        sandbox: "sandbox-123",
      },
      async () => [] as never,
    )
    const resolveId = async () => "sandbox-456"
    const byResolver = defineReaction(
      conversation.events.message,
      {
        key: "conversation.by-sandbox-resolver",
        scope: conversation,
        engine: false,
        sandbox: resolveId,
      },
      async () => [] as never,
    )

    expect(byId).not.toHaveProperty("sandbox")
    expect(byResolver).not.toHaveProperty("sandbox")
  })

  it("rejects a trigger outside the declared domain scope", () => {
    expect(() => defineReaction(
      unrelated.events.message,
      {
        key: "conversation.wrong-trigger",
        scope: conversation,
        engine: false,
        sandbox: false,
      },
      async () => [] as never,
    )).toThrow("reaction_trigger_outside_scope")
  })
})

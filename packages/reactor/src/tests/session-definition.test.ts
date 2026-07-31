import { describe, expect, it } from "vitest"

import { domain } from "../../../domain/src/index.ts"
import { ContextHandle } from "../../../events/src/index.ts"
import { ai } from "../reactor.ts"
import { Session } from "../session.ts"

const conversation = domain("conversationSessionTest")
  .withSchema({ entities: {}, links: {}, rooms: {} })

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
      scope: conversation,
      engine: false,
    })

    expect(session.from).toBeTypeOf("function")
    expect(session.complete).toBeTypeOf("function")
  })

  it("requires scope and engine while sandbox remains optional", () => {
    expect(() => new Session(runtime, context, {
      engine: false,
    } as never)).toThrow("session_scope_required")

    expect(() => new Session(runtime, context, {
      scope: conversation,
    } as never)).toThrow("session_engine_declaration_required")
  })
})

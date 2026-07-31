import { domain } from "@ekairos/domain"
import { ContextHandle } from "@ekairos/events"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { describe, expect, it } from "vitest"

import { Context, Session } from "../index.ts"

const scope = domain("contextWorkflowSafe")
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .scope({ events: [], actions: [] })

describe("Context and Session workflow serialization", () => {
  it("exposes the canonical open and session entries", () => {
    const client = Context({ db: async () => null, use: async () => null } as any)

    expect(client.open).toBeTypeOf("function")
    expect(client.session).toBeTypeOf("function")
  })

  it("restores Session identity, state, and Context handle", () => {
    const runtime = { db: async () => null, use: async () => null } as any
    const context = new ContextHandle(runtime, {
      id: "context-1",
      key: "conversation-1",
      content: Object.freeze({ policy: "durable" }),
    } as any)
    const session = new Session(runtime, context, {
      scope,
      engine: false,
      sandbox: false,
    })

    const serialized = (Session as any)[WORKFLOW_SERIALIZE](session)
    const restored = (Session as any)[WORKFLOW_DESERIALIZE](serialized)

    expect(restored).toBeInstanceOf(Session)
    expect(restored.context).toBe(context)
    expect(restored.from).toBeTypeOf("function")
    expect(restored.complete).toBeTypeOf("function")
    expect(restored[Symbol.asyncDispose]).toBeTypeOf("function")
  })
})

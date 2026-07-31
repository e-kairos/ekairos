import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { describe, expect, it } from "vitest"

import { SessionContextHandle } from "../index.ts"

describe("SessionContextHandle workflow serialization", () => {
  it("restores the concrete facade with session available", () => {
    const runtime = { db: async () => null, use: async () => null } as any
    const snapshot = Object.freeze({
      id: "context-1",
      key: "conversation-1",
      content: Object.freeze({ policy: "durable" }),
    }) as any
    const handle = new SessionContextHandle(runtime, snapshot)

    const serialized = (SessionContextHandle as any)[WORKFLOW_SERIALIZE](handle)
    const restored = (SessionContextHandle as any)[WORKFLOW_DESERIALIZE](serialized)

    expect(restored).toBeInstanceOf(SessionContextHandle)
    expect(restored.runtime).toBe(runtime)
    expect(restored.context).toBe(snapshot)
    expect(restored.session).toBeTypeOf("function")
    expect(restored.append).toBeTypeOf("function")
  })

  it("constructs a lazy Session without touching persistence", () => {
    const runtime = { db: async () => null, use: async () => null } as any
    const handle = new SessionContextHandle(runtime, {
      id: "context-1",
      key: null,
      content: null,
    } as any)

    const session = handle.session({
      scope: { getActions: () => [] } as any,
      engine: false,
      sandbox: false,
    })

    expect(session.from).toBeTypeOf("function")
    expect(session.complete).toBeTypeOf("function")
  })
})

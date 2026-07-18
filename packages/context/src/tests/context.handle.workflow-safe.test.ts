import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { describe, expect, it } from "vitest"

import { Context, ReactionContextHandle } from "../index.ts"

describe("ReactionContextHandle workflow serialization", () => {
  it("restores the concrete facade with react available", () => {
    const runtime = { db: async () => null, use: async () => null } as any
    const snapshot = Object.freeze({
      id: "context-1",
      key: "conversation-1",
      status: "open_idle" as const,
      content: Object.freeze({ policy: "durable" }),
    }) as any
    const handle = new ReactionContextHandle(runtime, snapshot)

    const serialized = (ReactionContextHandle as any)[WORKFLOW_SERIALIZE](handle)
    const restored = (ReactionContextHandle as any)[WORKFLOW_DESERIALIZE](serialized)

    expect(restored).toBeInstanceOf(ReactionContextHandle)
    expect(restored.runtime).toBe(runtime)
    expect(restored.context).toBe(snapshot)
    expect(restored.react).toBeTypeOf("function")
  })

  it("preserves the Reaction origin used by action-owned Context work", () => {
    const runtime = { db: async () => null, use: async () => null } as any
    const snapshot = Object.freeze({
      id: "context-1",
      key: "conversation-1",
      content: null,
    }) as any
    const origin = Object.freeze({
      sessionId: "session-1",
      reactionId: "reaction-1",
    })
    const handle = new ReactionContextHandle(runtime, snapshot, origin)

    const serialized = (ReactionContextHandle as any)[WORKFLOW_SERIALIZE](handle)
    const restored = (ReactionContextHandle as any)[WORKFLOW_DESERIALIZE](serialized)

    expect(restored.origin).toEqual(origin)
    expect(restored.emit).toBeTypeOf("function")
    expect(restored.react).toBeTypeOf("function")
  })

  it("does not emit a Reaction effect from an unbound Context", async () => {
    const runtime = { db: async () => null, use: async () => null } as any
    const handle = new ReactionContextHandle(runtime, {
      id: "context-1",
      key: null,
      content: null,
    } as any)

    await expect(handle.emit({} as any, { key: "effect" }))
      .rejects.toThrow("context_reaction_origin_required")
  })

  it("rejects an empty Reaction reference before querying persistence", async () => {
    const runtime = { db: async () => null, use: async () => null } as any

    await expect(Context(runtime).fromReaction("  "))
      .rejects.toThrow("context_reaction_id_required")
  })

  it("requires an idempotency key for bound Context emissions", async () => {
    const runtime = { db: async () => null, use: async () => null } as any
    const handle = new ReactionContextHandle(runtime, {
      id: "context-1",
      key: null,
      content: null,
    } as any, {
      sessionId: "session-1",
      reactionId: "reaction-1",
    })

    await expect(handle.emit({} as any, { key: "  " }))
      .rejects.toThrow("context_reaction_event_key_required")
  })
})

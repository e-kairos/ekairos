import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { describe, expect, it } from "vitest"

import { ReactionContextHandle } from "../index.ts"

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
})

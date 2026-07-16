import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { describe, expect, it } from "vitest"

import { ContextHandle } from "../context.handle.ts"

describe("ContextHandle workflow serialization", () => {
  it("preserves the runtime and immutable context snapshot", () => {
    const runtime = { db: async () => null } as any
    const snapshot = Object.freeze({
      id: "context-1",
      key: "conversation-1",
      status: "open_idle" as const,
      content: Object.freeze({ policy: "durable" }),
    }) as any
    const handle = new ContextHandle(runtime, snapshot)

    const serialized = (ContextHandle as any)[WORKFLOW_SERIALIZE](handle)
    const restored = (ContextHandle as any)[WORKFLOW_DESERIALIZE](serialized)

    expect(restored).toBeInstanceOf(ContextHandle)
    expect(restored.runtime).toBe(runtime)
    expect(restored.context).toBe(snapshot)
    expect(restored.id).toBe("context-1")
  })
})

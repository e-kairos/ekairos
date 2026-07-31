/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { start } from "workflow/api"

import {
  sessionSerializationWorkflow,
} from "./workflow/using.workflow-fixtures.ts"

describe("Session dentro de use workflow", () => {
  it("sobrevive la serializacion de un replay", async () => {
    const run = await start(sessionSerializationWorkflow, [])
    const result = await run.returnValue

    expect(result).toEqual({
      checkpoint: "step:session-checkpoint",
      contextId: "context-session-serde",
      contextKey: "context:session-serde",
      disposable: true,
    })
  })
})

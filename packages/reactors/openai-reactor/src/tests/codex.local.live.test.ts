import type { ReactionEngineInput } from "@ekairos/reactor"
import { expect, it } from "vitest"

import { codexEngine } from "../codex.engine.js"

const itLive = process.env.CODEX_LOCAL_LIVE === "1" ? it : it.skip

itLive("runs one minimal turn against the logged-in local Codex", async () => {
  const trigger = {
    id: "local-live-trigger",
    type: "test.prompted",
    domain: "test",
    name: "prompted",
    channel: "test",
    createdAt: new Date(),
    payload: { prompt: "Reply with the single word ok." },
    links: {},
    physicalLinks: {},
    metadata: {},
    eventParts: [],
  }
  const input: ReactionEngineInput = {
    reactionKey: "codex.local.live",
    runtime: {} as ReactionEngineInput["runtime"],
    context: {
      ref: { id: "local-live-context", key: "codex:local:live" },
      content: {},
    },
    trigger,
    sessionId: "local-live-session",
    reactionId: "local-live-reaction",
    events: [trigger],
    messages: [{
      role: "user",
      content: [{ type: "text", text: "Reply with the single word ok." }],
    }] as any,
    instruction: "Reply with the single word ok.",
    actions: {},
  }

  const result = await codexEngine({
    model: process.env.CODEX_LOCAL_MODEL,
  }).agent(input)

  expect(String(result.output).trim().toLowerCase()).toBe("ok")
})

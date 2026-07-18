/* @vitest-environment node */

import { describe, expect, it } from "vitest"

import { contextDomain } from "../schema.js"

describe("context persistence schema", () => {
  it("stores Contexts, Sessions, Events, causal Reactions, and eventParts only", () => {
    const schema = contextDomain.toInstantSchema() as any

    expect(Object.keys(schema.entities).filter(name => name.startsWith("context_")).sort()).toEqual([
      "context_contexts",
      "context_eventParts",
      "context_events",
      "context_reactions",
      "context_sessions",
    ])

    expect(schema.entities.context_sessions.links).toMatchObject({
      context: { entityName: "context_contexts", cardinality: "one" },
      trigger: { entityName: "context_events", cardinality: "one" },
      rootReaction: { entityName: "context_reactions", cardinality: "one" },
      parent: { entityName: "context_sessions", cardinality: "one" },
      children: { entityName: "context_sessions", cardinality: "many" },
    })

    expect(schema.entities.context_reactions.links).toMatchObject({
      session: { entityName: "context_sessions", cardinality: "one" },
      parent: { entityName: "context_reactions", cardinality: "one" },
      children: { entityName: "context_reactions", cardinality: "many" },
      causes: { entityName: "context_events", cardinality: "many" },
      effects: { entityName: "context_events", cardinality: "many" },
      stream: { entityName: "$streams", cardinality: "one" },
    })

    expect(schema.entities.context_reactions.attrs).toMatchObject({
      streamId: expect.anything(),
      streamClientId: expect.anything(),
      streamStartedAt: expect.anything(),
      streamFinishedAt: expect.anything(),
      streamError: expect.anything(),
    })

    expect(schema.entities.context_eventParts.links).toEqual({
      event: { entityName: "context_events", cardinality: "one" },
    })
    expect(schema.entities.context_events.links.files).toEqual({
      entityName: "$files",
      cardinality: "many",
    })
  })
})

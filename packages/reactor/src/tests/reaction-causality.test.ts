import type { ContextEvent, ContextReaction } from "@ekairos/events"
import { describe, expect, it } from "vitest"

import { resolveCausalEvents } from "../reaction-causality.js"

function event(id: string, producer?: string): ContextEvent {
  return {
    id,
    type: `test.${id}`,
    createdAt: new Date("2026-07-17T12:00:00.000Z"),
    payload: { id },
    links: {},
    physicalLinks: {},
    metadata: producer ? { reactionId: producer } : {},
    eventParts: [],
  }
}

function reaction(
  id: string,
  causeIds: string[],
  effectIds: string[] = [],
): ContextReaction {
  return {
    id,
    sessionId: "session",
    type: "test",
    status: "completed",
    position: 1,
    depth: 1,
    causeIds,
    effectIds,
    createdAt: new Date("2026-07-17T12:00:00.000Z"),
  }
}

describe("Reaction causal input", () => {
  const events = new Map([
    ["trigger", event("trigger")],
    ["repository", event("repository", "clone")],
    ["attachments", event("attachments", "load-files")],
    ["findings", event("findings", "dataset")],
  ])
  const reactions = new Map([
    ["clone", reaction("clone", ["trigger"])],
    ["load-files", reaction("load-files", ["trigger"])],
    ["dataset", reaction("dataset", ["attachments"])],
  ])

  const resolve = (sourceIds: readonly string[]) => resolveCausalEvents({
    sourceIds,
    getEvent: async id => events.get(id) ?? null,
    getReaction: async id => reactions.get(id) ?? null,
  })

  it("includes transitive ancestors in causal order", async () => {
    expect((await resolve(["findings"])).map(row => row.id))
      .toEqual(["trigger", "attachments", "findings"])
  })

  it("does not include a sibling until the caller performs fan-in", async () => {
    expect((await resolve(["repository", "findings"])).map(row => row.id))
      .toEqual(["trigger", "repository", "attachments", "findings"])
  })

  it("includes only preceding effects from the same multi-effect Reaction", async () => {
    const orderedEvents = new Map([
      ["trigger", event("trigger")],
      ["model-0", event("model-0", "agent")],
      ["action-0", event("action-0", "agent")],
      ["model-1", event("model-1", "agent")],
    ])
    const orderedReactions = new Map([
      ["agent", reaction("agent", ["trigger"], ["model-0", "action-0", "model-1"])],
    ])
    const resolveOrdered = (sourceIds: readonly string[]) => resolveCausalEvents({
      sourceIds,
      getEvent: async id => orderedEvents.get(id) ?? null,
      getReaction: async id => orderedReactions.get(id) ?? null,
    })

    expect((await resolveOrdered(["action-0"])).map(row => row.id))
      .toEqual(["trigger", "model-0", "action-0"])
    expect((await resolveOrdered(["model-1"])).map(row => row.id))
      .toEqual(["trigger", "model-0", "action-0", "model-1"])
  })

  it("follows metadata causeIds for exogenous Context Events", async () => {
    const exogenousEvents = new Map([
      ["root", event("root")],
      ["reply", {
        ...event("reply"),
        metadata: { causeIds: ["root"] },
      }],
    ])

    expect((await resolveCausalEvents({
      sourceIds: ["reply"],
      getEvent: async id => exogenousEvents.get(id) ?? null,
      getReaction: async () => null,
    })).map(row => row.id)).toEqual(["root", "reply"])
  })

  it("fails when graph metadata references a missing producer", async () => {
    const broken = new Map(events).set("broken", event("broken", "missing"))
    await expect(resolveCausalEvents({
      sourceIds: ["broken"],
      getEvent: async id => broken.get(id) ?? null,
      getReaction: async id => reactions.get(id) ?? null,
    })).rejects.toThrow("session_from_producer_not_found:missing")
  })
})

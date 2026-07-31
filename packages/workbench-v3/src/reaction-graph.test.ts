import type {
  ContextEventForUI,
  ContextReactionForUI,
  ContextSessionForUI,
} from "@ekairos/events/react"
import { describe, expect, it } from "vitest"

import {
  buildEventTimeline,
  reactionTitle,
} from "../../registry/components/ekairos/reactions/reaction-graph"

function event(
  id: string,
  type: string,
  createdAt = "2026-07-16T12:00:00.000Z",
): ContextEventForUI {
  return {
    id,
    type,
    createdAt,
    payload: {},
    links: {},
    metadata: {},
    eventParts: [],
    durability: "durable",
  }
}

function reaction(input: {
  id: string
  type: string
  position: number
  causes: ContextEventForUI[]
  effects: ContextEventForUI[]
  instruction?: string
  parent?: ContextReactionForUI | null
}): ContextReactionForUI {
  return {
    id: input.id,
    type: input.type,
    status: "completed",
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:01.000Z",
    position: input.position,
    depth: input.position === 0 ? 0 : 1,
    causeIds: input.causes.map(row => row.id),
    effectIds: input.effects.map(row => row.id),
    ...(input.instruction ? { instruction: input.instruction } : {}),
    causes: input.causes,
    effects: input.effects,
    stream: null,
    liveEffects: [],
    parent: input.parent ? { id: input.parent.id, type: input.parent.type } : null,
  }
}

describe("Workbench causal timeline", () => {
  it("orders the Event log chronologically and resolves each producer", () => {
    const trigger = event("trigger", "workbench.messageReceived", "2026-07-16T12:00:00.000Z")
    const dataset = event("dataset", "context.dataset", "2026-07-16T12:00:01.000Z")
    const requirements = event("requirements", "context.agent", "2026-07-16T12:00:02.000Z")
    const risks = event("risks", "context.agent", "2026-07-16T12:00:03.000Z")
    const decision = event("decision", "context.agent", "2026-07-16T12:00:04.000Z")
    const recorded = event("recorded", "context.action", "2026-07-16T12:00:05.000Z")
    const completed = event("completed", "workbench.reviewCompleted", "2026-07-16T12:00:06.000Z")
    const rows = [
      reaction({ id: "root", type: "workbench.review-request", position: 0, causes: [trigger], effects: [completed] }),
      reaction({ id: "items", type: "dataset", position: 1, causes: [trigger], effects: [dataset] }),
      reaction({ id: "requirements", type: "agent", position: 2, causes: [trigger], effects: [requirements] }),
      reaction({ id: "risks", type: "agent", position: 3, causes: [trigger], effects: [risks] }),
      reaction({ id: "decision", type: "agent", position: 4, causes: [dataset, requirements, risks], effects: [decision] }),
      reaction({ id: "record", type: "action", position: 5, causes: [dataset, risks, decision], effects: [recorded] }),
      reaction({ id: "emit", type: "emit", position: 6, causes: [recorded], effects: [completed] }),
    ]
    const session: ContextSessionForUI = {
      id: "session",
      definition: "workbench.review-request",
      status: "completed",
      createdAt: "2026-07-16T12:00:00.000Z",
      trigger,
      rootReaction: rows[0]!,
      reactions: rows,
      children: [],
    }

    const timeline = buildEventTimeline(session)
    expect(timeline.rows.map(row => row.event.id)).toEqual([
      "trigger",
      "dataset",
      "requirements",
      "risks",
      "decision",
      "recorded",
      "completed",
    ])
    expect(timeline.rows[0]?.producer).toBeNull()
    expect(timeline.rows.map(row => row.producer?.id ?? null)).toEqual([
      null,
      "items",
      "requirements",
      "risks",
      "decision",
      "record",
      "emit",
    ])
    expect(timeline.rows.every(row => !row.child && row.branch === 0)).toBe(true)
    expect(reactionTitle(rows[6]!)).toBe("Publish reviewCompleted")

    // Everything traces back to the trigger: every non-first row has an
    // incoming edge, and no spawn fallback was needed here.
    const targets = new Set(timeline.edges.map(edge => edge.to))
    expect(timeline.rows.slice(1).every(row => targets.has(row.event.id))).toBe(true)
    expect(timeline.edges.every(edge => edge.kind === "flow")).toBe(true)
    // Fan-in draws one edge per cause into the effect.
    expect(timeline.edges
      .filter(edge => edge.reactionId === "decision")
      .map(edge => [edge.from, edge.to])).toEqual([
      ["dataset", "decision"],
      ["requirements", "decision"],
      ["risks", "decision"],
    ])
    // Lanes: trigger holds lane 0 until its last fan-out sibling inherits it;
    // parallel siblings take nearest free lanes; the convergence rows come
    // back toward the center once their parent lines end.
    expect(timeline.rows.map(row => row.lane)).toEqual([0, 1, 2, 0, 3, 1, 1])
    expect(timeline.lanes).toBe(4)
  })

  it("keeps child-Session Events on the same log, marked as a branch", () => {
    const trigger = event("trigger", "workbench.messageReceived", "2026-07-16T12:00:00.000Z")
    const model0 = event("model-0", "context.model", "2026-07-16T12:00:01.000Z")
    // Emitted from inside the Action: no Reaction lists it as an effect.
    const requested = event("verify-requested", "workbench.reviewVerificationRequested", "2026-07-16T12:00:02.000Z")
    const action0 = event("action-0", "context.action", "2026-07-16T12:00:03.000Z")
    const model1 = event("model-1", "context.model", "2026-07-16T12:00:04.000Z")
    const childModel = event("child-model", "context.model", "2026-07-16T12:00:05.000Z")
    const verified = event("verified", "workbench.reviewVerificationCompleted", "2026-07-16T12:00:06.000Z")
    const completed = event("completed", "workbench.reviewCompleted", "2026-07-16T12:00:07.000Z")
    const root = reaction({
      id: "root",
      type: "workbench.review-request",
      position: 0,
      causes: [trigger],
      effects: [completed],
    })
    const agent = reaction({
      id: "agent",
      type: "agent",
      position: 1,
      causes: [trigger],
      effects: [model0, action0, model1],
    })
    const childRoot = reaction({
      id: "child-root",
      type: "workbench.verify-recorded-review",
      position: 0,
      causes: [requested],
      effects: [verified],
      parent: agent,
    })
    const childAgent = reaction({
      id: "child-agent",
      type: "agent",
      position: 1,
      causes: [requested],
      effects: [childModel],
      parent: childRoot,
    })
    const childEmit = reaction({
      id: "child-emit",
      type: "emit",
      position: 2,
      causes: [childModel],
      effects: [verified],
      parent: childRoot,
    })
    const emit = reaction({
      id: "emit",
      type: "emit",
      position: 2,
      causes: [model1, verified],
      effects: [completed],
    })
    const child: ContextSessionForUI = {
      id: "child-session",
      definition: "workbench.verify-recorded-review",
      status: "completed",
      parentSessionId: "session",
      parentReactionId: "agent",
      createdAt: "2026-07-16T12:00:02.000Z",
      trigger: requested,
      rootReaction: childRoot,
      reactions: [childRoot, childAgent, childEmit],
      children: [],
    }
    const session: ContextSessionForUI = {
      id: "session",
      definition: "workbench.review-request",
      status: "completed",
      createdAt: "2026-07-16T12:00:00.000Z",
      trigger,
      rootReaction: root,
      reactions: [root, agent, emit],
      children: [child],
    }

    const timeline = buildEventTimeline(session)
    // The log stays strictly chronological: nothing appears out of nowhere,
    // the branch Events sit exactly where they happened.
    expect(timeline.rows.map(row => row.event.id)).toEqual([
      "trigger",
      "model-0",
      "verify-requested",
      "action-0",
      "model-1",
      "child-model",
      "verified",
      "completed",
    ])
    expect(timeline.rows.filter(row => row.child).map(row => [row.event.id, row.branch])).toEqual([
      ["verify-requested", 1],
      ["child-model", 1],
      ["verified", 1],
    ])
    // The unproduced branch trigger has no producer and carries the badge.
    const start = timeline.rows.find(row => row.event.id === "verify-requested")
    expect(start?.producer).toBeNull()
    expect(start?.branchOf).toBe("workbench.verify-recorded-review")
    // Everything else resolves its producing Reaction.
    expect(timeline.rows.find(row => row.event.id === "child-model")?.producer?.id).toBe("child-agent")
    expect(timeline.rows.find(row => row.event.id === "completed")?.producer?.id).toBe("emit")
    // The unproduced branch trigger hangs off its spawning Reaction's newest
    // earlier Event via a dashed spawn edge — it starts from the graph, not
    // from nowhere.
    expect(timeline.edges.filter(edge => edge.kind === "spawn")).toEqual([{
      id: "verify-requested:spawn",
      reactionId: "agent",
      from: "model-0",
      to: "verify-requested",
      kind: "spawn",
    }])
    const targets = new Set(timeline.edges.map(edge => edge.to))
    expect(timeline.rows.slice(1).every(row => targets.has(row.event.id))).toBe(true)
    // The main chain rides lane 0; the verification branch lives beside it
    // and the final convergence lands on the central parent lane.
    expect(timeline.rows.map(row => row.lane)).toEqual([0, 0, 1, 0, 0, 2, 2, 2])
  })
})

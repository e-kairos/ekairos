import type {
  ContextEventForUI,
  ContextReactionForUI,
  ContextSessionForUI,
} from "@ekairos/events/react"
import { describe, expect, it } from "vitest"

import { buildReactionGantt } from "./reaction-gantt"

const trigger = event("trigger", "workbench.messageReceived", 0)
const items = event("items", "context.dataset", 4_000)
const risks = event("risks", "context.model", 5_000)
const answer = event("answer", "workbench.messageAnswered", 9_000)
const root = reaction("root", "workbench.answer", 0, 10_000, [trigger], [answer])
const dataset = reaction("dataset", "dataset", 1_000, 4_000, [trigger], [items])
const agent = reaction("agent", "agent", 1_000, 5_000, [trigger], [risks])
const emit = reaction("emit", "emit", 7_000, 9_000, [risks], [answer])

const session: ContextSessionForUI = {
  id: "session",
  definition: "workbench.answer",
  status: "completed",
  workflowRunId: "wrun-1",
  createdAt: date(0),
  updatedAt: date(10_000),
  trigger,
  rootReaction: root,
  reactions: [root, dataset, agent, emit],
  children: [],
}

describe("Reaction Gantt", () => {
  it("projects one Workflow row and one row per operation Reaction", () => {
    const gantt = buildReactionGantt(session, new Date(date(12_000)).valueOf())

    expect(gantt.durationMs).toBe(10_000)
    expect(gantt.rows.map(row => [row.kind, row.id])).toEqual([
      ["workflow", "session"],
      ["reaction", "dataset"],
      ["reaction", "agent"],
      ["reaction", "emit"],
    ])
    expect(gantt.rows[1]).toMatchObject({ offsetPercent: 10, widthPercent: 30 })
    expect(gantt.rows[2]).toMatchObject({ offsetPercent: 10, widthPercent: 40 })
    expect(gantt.rows[3]).toMatchObject({ offsetPercent: 70, widthPercent: 20 })
  })
})

function date(offset: number) {
  return new Date(Date.UTC(2026, 6, 18, 12, 0, 0, offset)).toISOString()
}

function event(id: string, type: string, offset: number): ContextEventForUI {
  return {
    id,
    type,
    createdAt: date(offset),
    payload: {},
    links: {},
    metadata: {},
    eventParts: [],
    durability: "durable",
  }
}

function reaction(
  id: string,
  type: string,
  start: number,
  end: number,
  causes: ContextEventForUI[],
  effects: ContextEventForUI[],
): ContextReactionForUI {
  return {
    id,
    type,
    status: "completed",
    createdAt: date(start),
    updatedAt: date(end),
    position: start,
    depth: id === "root" ? 0 : 1,
    causeIds: causes.map(value => value.id),
    effectIds: effects.map(value => value.id),
    causes,
    effects,
    stream: null,
    liveEffects: [],
    parent: id === "root" ? null : { id: "root", type: "workbench.answer" },
  }
}

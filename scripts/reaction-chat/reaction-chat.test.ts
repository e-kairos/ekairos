import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { parseCliArgs } from "./args.ts"
import { eventText, executeReactionTurn } from "./reaction-module.ts"
import {
  emptyReactionGraph,
  projectSessionTimeline,
  reduceSessionLog,
  relationIds,
} from "./reaction-view.ts"
import { buildTimelineRail } from "./timeline-rail.ts"
import { createReactionNavigator } from "./reaction-navigator.ts"
import {
  limitRowLines,
  selectCenteredTerminalViewport,
  selectTerminalViewport,
} from "./terminal-viewport.ts"

describe("reaction chat", () => {
  it("navigates causal branches through fan-out and fan-in", () => {
    const ids = ["request", "plan", "research", "risks", "synthesis", "publish"]
    const lanes = [0, 0, 0, 1, 0, 0]
    const timeline = {
      lanes: 2,
      rows: ids.map((id, index) => ({
        event: { id },
        lane: lanes[index],
        producer: null,
        child: false,
        branch: 0,
        branchOf: null,
      })),
      edges: [
        ["request", "plan"],
        ["plan", "research"],
        ["plan", "risks"],
        ["research", "synthesis"],
        ["risks", "synthesis"],
        ["synthesis", "publish"],
      ].map(([from, to], index) => ({
        id: `edge-${index}`,
        reactionId: `reaction-${index}`,
        from,
        to,
        kind: "flow" as const,
      })),
    } as never
    const navigator = createReactionNavigator(timeline)

    expect(navigator.move("plan", "down")).toBe("research")
    expect(navigator.move("research", "left")).toBe("risks")
    expect(navigator.move("risks", "right")).toBe("research")
    expect(navigator.move("risks", "down")).toBe("synthesis")
    expect(navigator.move("synthesis", "left")).toBe("risks")
    expect(navigator.move("synthesis", "right")).toBe("research")
    expect(navigator.node("plan")).toMatchObject({ fanIn: 1, fanOut: 2 })
    expect(navigator.node("synthesis")).toMatchObject({ fanIn: 2, fanOut: 1 })
    expect([...navigator.activeBranch("research")]).toEqual(expect.arrayContaining([
      "request",
      "plan",
      "research",
      "synthesis",
      "publish",
    ]))
    expect(navigator.activeBranch("research").has("risks")).toBe(false)
  })

  it("keeps the terminal viewport within its physical line budget", () => {
    const rows = Array.from({ length: 8 }, (_, index) => [`event-${index}`])
    const viewport = selectTerminalViewport(rows, 5)
    const renderedLines = viewport.rows.reduce((sum, row) => sum + row.lines.length, 0)
      + (viewport.hiddenRows > 0 ? 1 : 0)

    expect(renderedLines).toBeLessThanOrEqual(5)
    expect(viewport.hiddenRows).toBe(4)
    expect(viewport.rows.map(row => row.rowIndex)).toEqual([4, 5, 6, 7])
  })

  it("centers the tree viewport around the selected causal Event", () => {
    const rows = Array.from({ length: 9 }, (_, index) => [`event-${index}`])
    const viewport = selectCenteredTerminalViewport(rows, 4, 5)
    const renderedLines = viewport.rows.reduce((sum, row) => sum + row.lines.length, 0)
      + (viewport.hiddenBefore > 0 ? 1 : 0)
      + (viewport.hiddenAfter > 0 ? 1 : 0)

    expect(renderedLines).toBeLessThanOrEqual(5)
    expect(viewport.rows.map(row => row.rowIndex)).toEqual([3, 4, 5])
    expect(viewport.hiddenBefore).toBe(3)
    expect(viewport.hiddenAfter).toBe(3)
  })

  it("collapses oversized Event Parts into one overflow line", () => {
    const lines = Array.from({ length: 9 }, (_, index) => `line-${index}`)
    expect(limitRowLines(lines, 4, hidden => `hidden-${hidden}`)).toEqual([
      "line-0",
      "line-1",
      "line-2",
      "hidden-6",
    ])
  })

  it("parses a strict reaction module invocation", () => {
    expect(parseCliArgs([
      "reaction.ts",
      "--context",
      "customer:42",
      "--input",
      '{"text":"hello"}',
      "--json",
    ])).toEqual({
      modulePath: "reaction.ts",
      contextKey: "customer:42",
      input: { text: "hello" },
      json: true,
    })
  })

  it("loads react and returns its ContextEvent", async () => {
    const result = await executeReactionTurn({
      modulePath: resolve("scripts/reaction-chat/examples/echo.ts"),
      contextKey: "test:echo",
      input: { text: "hello" },
    })

    expect(result.event.type).toBe("reactionChat.echo.completed")
    expect(eventText(result.event)).toBe('Echo [test:echo]: {"text":"hello"}')
  })

  it("reduces durable entities and live deltas into a reaction view", () => {
    const withReaction = reduceSessionLog(emptyReactionGraph(), {
      kind: "entity",
      entity: "context_reactions",
      id: "reaction-1",
      value: {
        type: "agent",
        status: "running",
        links: { causes: ["event-1", "event-2"] },
      },
    })
    const firstDelta = reduceSessionLog(withReaction, {
      kind: "stream",
      sessionId: "session-1",
      reactionId: "reaction-1",
      streamId: "stream-1",
      chunk: {
        version: 1,
        kind: "text.delta",
        reactionId: "reaction-1",
        eventId: "event-3",
        sequence: 1,
        at: new Date().toISOString(),
        round: 0,
        partId: "message:0",
        delta: "hello ",
      },
    })
    const secondDelta = reduceSessionLog(firstDelta, {
      kind: "stream",
      sessionId: "session-1",
      reactionId: "reaction-1",
      streamId: "stream-1",
      chunk: {
        version: 1,
        kind: "text.delta",
        reactionId: "reaction-1",
        eventId: "event-3",
        sequence: 2,
        at: new Date().toISOString(),
        round: 0,
        partId: "message:0",
        delta: "world",
      },
    })

    expect(secondDelta.streams["reaction-1"]?.text).toBe("hello world")
    expect(secondDelta.streams["reaction-1"]?.chunkCount).toBe(2)
    expect(secondDelta.streams["reaction-1"]?.chunks).toHaveLength(2)
    expect(secondDelta.streams["reaction-1"]?.textDeltas).toBe(2)
    expect(secondDelta.streams["reaction-1"]?.projections).toHaveLength(1)
    expect(relationIds(
      secondDelta.entities.context_reactions["reaction-1"],
      "causes",
    )).toEqual(["event-1", "event-2"])
  })

  it("replaces a streaming Event projection with its durable Event in place", () => {
    const entityRecords = [
      {
        kind: "entity" as const,
        entity: "context_sessions" as const,
        id: "session-live",
        value: {
          id: "session-live",
          definition: "session",
          status: "running",
          createdAt: "2026-08-04T00:00:00.000Z",
          links: {
            trigger: ["event-trigger"],
            rootReaction: ["reaction-root"],
            reactions: ["reaction-root", "reaction-live"],
          },
        },
      },
      {
        kind: "entity" as const,
        entity: "context_events" as const,
        id: "event-trigger",
        value: {
          id: "event-trigger",
          type: "example.messageReceived",
          createdAt: "2026-08-04T00:00:00.000Z",
          payload: { text: "hello" },
        },
      },
      {
        kind: "entity" as const,
        entity: "context_reactions" as const,
        id: "reaction-root",
        value: {
          id: "reaction-root",
          type: "session",
          status: "running",
          position: 0,
          depth: 0,
          createdAt: "2026-08-04T00:00:00.000Z",
          links: { causes: ["event-trigger"] },
        },
      },
      {
        kind: "entity" as const,
        entity: "context_reactions" as const,
        id: "reaction-live",
        value: {
          id: "reaction-live",
          type: "agent",
          status: "running",
          position: 1,
          depth: 1,
          createdAt: "2026-08-04T00:00:01.000Z",
          links: { parent: ["reaction-root"], causes: ["event-trigger"] },
        },
      },
    ]
    const withEntities = entityRecords.reduce(reduceSessionLog, emptyReactionGraph())
    const withStarted = reduceSessionLog(withEntities, {
      kind: "stream",
      sessionId: "session-live",
      reactionId: "reaction-live",
      streamId: "stream-live",
      chunk: {
        version: 1,
        kind: "model.round.started",
        reactionId: "reaction-live",
        eventId: "event-live",
        sequence: 1,
        at: "2026-08-04T00:00:01.000Z",
        round: 0,
        data: { eventType: "context.model" },
      },
    })
    const streamingGraph = reduceSessionLog(withStarted, {
      kind: "stream",
      sessionId: "session-live",
      reactionId: "reaction-live",
      streamId: "stream-live",
      chunk: {
        version: 1,
        kind: "text.delta",
        reactionId: "reaction-live",
        eventId: "event-live",
        sequence: 2,
        at: "2026-08-04T00:00:02.000Z",
        round: 0,
        partId: "message:0",
        delta: "streaming text",
      },
    })
    const streaming = projectSessionTimeline(streamingGraph, "session-live")
    expect(streaming.rows.map(row => row.event.id)).toEqual(["event-trigger", "event-live"])
    expect(streaming.rows[1]?.event.durability).toBe("streaming")
    expect(streaming.rows[1]?.event.eventParts[0]?.content).toEqual({ text: "streaming text" })

    const durableRecords = [
      {
        kind: "entity" as const,
        entity: "context_eventParts" as const,
        id: "part-live",
        value: {
          id: "part-live",
          key: "event-live:0",
          index: 0,
          type: "message",
          content: { text: "durable text" },
          createdAt: "2026-08-04T00:00:03.000Z",
        },
      },
      {
        kind: "entity" as const,
        entity: "context_events" as const,
        id: "event-live",
        value: {
          id: "event-live",
          type: "context.model",
          createdAt: "2026-08-04T00:00:01.000Z",
          payload: { text: "durable text" },
          links: { eventParts: ["part-live"] },
        },
      },
      {
        kind: "entity" as const,
        entity: "context_reactions" as const,
        id: "reaction-live",
        value: {
          id: "reaction-live",
          type: "agent",
          status: "completed",
          position: 1,
          depth: 1,
          createdAt: "2026-08-04T00:00:01.000Z",
          updatedAt: "2026-08-04T00:00:03.000Z",
          links: {
            parent: ["reaction-root"],
            causes: ["event-trigger"],
            effects: ["event-live"],
          },
        },
      },
    ]
    const durableGraph = durableRecords.reduce(reduceSessionLog, streamingGraph)
    const durable = projectSessionTimeline(durableGraph, "session-live")
    expect(durable.rows.map(row => row.event.id)).toEqual(["event-trigger", "event-live"])
    expect(durable.rows[1]?.event.durability).toBe("durable")
    expect(durable.rows[1]?.event.eventParts[0]?.content).toEqual({ text: "durable text" })
  })

  it("projects every Event once across a three-way convergence and an action", () => {
    const records = [
      {
        kind: "entity" as const,
        entity: "context_sessions" as const,
        id: "session-1",
        value: {
          links: {
            trigger: ["event-message"],
            rootReaction: ["reaction-session"],
            reactions: ["reaction-session", "reaction-agent", "reaction-action"],
          },
        },
      },
      {
        kind: "entity" as const,
        entity: "context_reactions" as const,
        id: "reaction-session",
        value: {
          type: "session",
          position: 0,
          links: {
            causes: ["event-message"],
            effects: ["event-action"],
          },
        },
      },
      {
        kind: "entity" as const,
        entity: "context_reactions" as const,
        id: "reaction-agent",
        value: {
          type: "agent",
          position: 1,
          links: {
            causes: ["event-message"],
            effects: ["event-model", "event-evidence", "event-policy"],
          },
        },
      },
      {
        kind: "entity" as const,
        entity: "context_reactions" as const,
        id: "reaction-action",
        value: {
          type: "action",
          position: 2,
          links: {
            causes: ["event-model", "event-evidence", "event-policy"],
            effects: ["event-action"],
          },
        },
      },
      ...[
        ["event-message", "reactionChatExample.messageReceived", "2026-08-04T00:00:00.000Z"],
        ["event-model", "context.model", "2026-08-04T00:00:01.000Z"],
        ["event-evidence", "context.model", "2026-08-04T00:00:02.000Z"],
        ["event-policy", "context.model", "2026-08-04T00:00:03.000Z"],
        ["event-action", "context.action", "2026-08-04T00:00:04.000Z"],
      ].map(([id, type, createdAt]) => ({
        kind: "entity" as const,
        entity: "context_events" as const,
        id: id!,
        value: { id, type, createdAt, payload: { text: id } },
      })),
    ]
    const graph = records.reduce(reduceSessionLog, emptyReactionGraph())
    const timeline = projectSessionTimeline(graph, "session-1")

    expect(timeline.rows.map(row => row.event.id)).toEqual([
      "event-message",
      "event-model",
      "event-evidence",
      "event-policy",
      "event-action",
    ])
    expect(timeline.rows.map(row => row.producer?.id ?? null)).toEqual([
      null,
      "reaction-agent",
      "reaction-agent",
      "reaction-agent",
      "reaction-action",
    ])
    expect(timeline.edges
      .filter(edge => edge.reactionId === "reaction-action")
      .map(edge => [edge.from, edge.to])).toEqual([
      ["event-model", "event-action"],
      ["event-evidence", "event-action"],
      ["event-policy", "event-action"],
    ])

    const heights = [2, 3, 2, 2, 2]
    const rail = buildTimelineRail(timeline, heights)
    expect(new Set(rail.lines.map(line => line.length))).toEqual(new Set([rail.width]))
    let offset = 0
    heights.forEach(height => {
      expect(rail.lines[offset]).toContain("●")
      for (let line = offset + 1; line < offset + height; line += 1) {
        expect(rail.lines[line]).toMatch(/[│├┤┼]/)
      }
      offset += height
    })

    const activeIds = new Set(["event-message", "event-model", "event-action"])
    const activeRail = buildTimelineRail(timeline, heights, activeIds)
    offset = 0
    timeline.rows.forEach((row, index) => {
      if (activeIds.has(row.event.id)) {
        expect(activeRail.activeLines[offset]).toContain("●")
      } else {
        expect(activeRail.activeLines[offset]).not.toContain("●")
      }
      offset += heights[index]!
    })
  })
})

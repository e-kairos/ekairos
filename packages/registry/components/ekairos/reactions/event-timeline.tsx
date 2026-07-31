"use client"

import {
  getPartText,
  type ContextEventForUI,
  type ContextReactionForUI,
  type ContextSessionForUI,
} from "@ekairos/events/react"
import { type CSSProperties, useMemo } from "react"

import {
  buildEventTimeline,
  reactionDurationMs,
  reactionTitle,
} from "./reaction-graph"
import "./event-timeline.css"

export type EventTimelineViewProps = {
  session: ContextSessionForUI
  selectedId: string | null
  onSelect(id: string): void
  variant?: "inspector" | "chat"
  omit?: ReadonlySet<string>
}

const TIMELINE_ROW_HEIGHT = 27
const TIMELINE_LANE_WIDTH = 12
const TIMELINE_RAIL_BASE = 15
const TIMELINE_BRANCH_COLORS = [
  "var(--event-timeline-branch-0, #5c6a70)",
  "var(--event-timeline-branch-1, #75aadb)",
  "var(--event-timeline-branch-2, #d4af37)",
  "var(--event-timeline-branch-3, #65d688)",
  "var(--event-timeline-branch-4, #cfc3f5)",
  "var(--event-timeline-branch-5, #ff5c67)",
] as const

export function EventTimelineView({
  session,
  selectedId,
  onSelect,
  variant = "inspector",
  omit,
}: EventTimelineViewProps) {
  const timeline = useMemo(() => buildEventTimeline(session), [session])
  const rows = useMemo(
    () => omit ? timeline.rows.filter(row => !omit.has(row.event.id)) : timeline.rows,
    [timeline, omit],
  )
  const selected = useMemo(
    () => allSessionReactions(session).find(reaction => reaction.id === selectedId) ?? null,
    [session, selectedId],
  )
  const causeIds = useMemo(() => new Set(selected?.causeIds ?? []), [selected])
  const reactionCount = new Set(rows.map(row => row.producer?.id).filter(Boolean)).size
  const firstProducerRow = useMemo(() => {
    const first = new Map<string, number>()
    rows.forEach((row, index) => {
      const id = row.producer?.id
      if (id && !first.has(id)) first.set(id, index)
    })
    return first
  }, [rows])
  const chat = variant === "chat"
  const positions = useMemo(() => new Map(
    rows.map((row, index) => [row.event.id, { index, lane: row.lane, branch: row.branch }]),
  ), [rows])
  const railWidth = TIMELINE_RAIL_BASE + timeline.lanes * TIMELINE_LANE_WIDTH + 4
  const orderedEdges = [
    ...timeline.edges.filter(edge => edge.reactionId !== selectedId),
    ...timeline.edges.filter(edge => edge.reactionId === selectedId),
  ]

  return (
    <section className={`event-timeline ${variant}`} data-variant={variant}>
      {chat ? null : (
        <header className="timeline-toolbar">
          <strong>{session.definition}</strong>
          <span>{rows.length} Events / {reactionCount} Reactions</span>
        </header>
      )}
      <div className="timeline" style={{ "--rail-w": `${railWidth}px` } as CSSProperties}>
        <svg
          aria-hidden="true"
          className="timeline-edges"
          height={rows.length * TIMELINE_ROW_HEIGHT}
          width={railWidth}
        >
          {orderedEdges.map(edge => {
            const from = positions.get(edge.from)
            const to = positions.get(edge.to)
            if (!from || !to) return null
            const active = edge.reactionId === selectedId
            return (
              <path
                className={[edge.kind, active ? "selected" : ""].filter(Boolean).join(" ")}
                d={timelineEdgePath(from, to, railWidth)}
                key={edge.id}
                stroke={active
                  ? "var(--event-timeline-accent, #7defff)"
                  : branchColor(Math.max(from.branch, to.branch))}
              />
            )
          })}
        </svg>
        {rows.map((row, index) => {
          const producer = row.producer
          const duration = producer ? reactionDurationMs(producer) : null
          const repeatedProducer =
            producer !== null && firstProducerRow.get(producer.id) !== index
          const summary = eventSummary(row.event)
          const classNames = [
            "timeline-row",
            producer && producer.id === selectedId ? "selected" : "",
            causeIds.has(row.event.id) ? "cause" : "",
            row.child ? "child" : "",
            `durability-${row.event.durability ?? "durable"}`,
            producer?.status === "failed" ? "failed" : "",
            producer?.status === "running" ? "running" : "",
          ].filter(Boolean).join(" ")

          return (
            <button
              aria-pressed={producer ? producer.id === selectedId : undefined}
              className={classNames}
              disabled={!producer}
              key={row.event.id}
              onClick={() => producer && onSelect(producer.id)}
              title={producer ? reactionTitle(producer) : row.event.id}
              type="button"
            >
              <span
                className="timeline-rail"
                style={{
                  "--dot-r": `${TIMELINE_RAIL_BASE + row.lane * TIMELINE_LANE_WIDTH}px`,
                  "--dot": branchColor(row.branch),
                } as CSSProperties}
              >
                <span className="timeline-dot" />
              </span>
              {chat ? (
                summary
                  ? <span className="timeline-summary">{summary}</span>
                  : <span className="timeline-type">{row.event.type}</span>
              ) : (
                <>
                  <span className="timeline-type">{row.event.type}</span>
                  <span className="timeline-summary">{summary}</span>
                </>
              )}
              {row.branchOf ? (
                <span className="timeline-badge" title={row.branchOf}>
                  {compactName(row.branchOf)}
                </span>
              ) : null}
              <span className="timeline-reaction">
                {producer
                  ? repeatedProducer
                    ? "·"
                    : `${producer.type.split(":")[0]}${duration === null ? "" : ` ${(duration / 1000).toFixed(1)}s`}`
                  : "trigger"}
              </span>
              {chat ? null : <time>{clock(row.event.createdAt)}</time>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function allSessionReactions(session: ContextSessionForUI): ContextReactionForUI[] {
  const rows = [
    ...session.reactions,
    ...session.children.flatMap(allSessionReactions),
  ]
  return [...new Map(rows.map(reaction => [reaction.id, reaction])).values()]
}

function compactName(value: string) {
  const base = value.split(":")[0] ?? value
  return base.split(".").pop() || base
}

function branchColor(branch: number) {
  return TIMELINE_BRANCH_COLORS[branch % TIMELINE_BRANCH_COLORS.length]!
}

function timelineEdgePath(
  from: { index: number; lane: number },
  to: { index: number; lane: number },
  railWidth: number,
) {
  const x1 = railWidth - TIMELINE_RAIL_BASE - from.lane * TIMELINE_LANE_WIDTH
  const x2 = railWidth - TIMELINE_RAIL_BASE - to.lane * TIMELINE_LANE_WIDTH
  const y1 = from.index * TIMELINE_ROW_HEIGHT + TIMELINE_ROW_HEIGHT / 2
  const y2 = to.index * TIMELINE_ROW_HEIGHT + TIMELINE_ROW_HEIGHT / 2
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const bend = Math.max(y1, y2 - TIMELINE_ROW_HEIGHT)
  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${bend}`,
    `C ${x1} ${bend + TIMELINE_ROW_HEIGHT * 0.65}, ${x2} ${y2 - TIMELINE_ROW_HEIGHT * 0.65}, ${x2} ${y2}`,
  ].join(" ")
}

function eventSummary(event: ContextEventForUI) {
  const payload = event.payload as Record<string, unknown> | null
  const direct = typeof event.payload === "string"
    ? event.payload
    : typeof payload?.text === "string"
      ? payload.text
      : typeof payload?.summary === "string"
        ? payload.summary
        : event.eventParts.map(getPartText).filter(Boolean).join("\n")
  if (direct) return clip(direct)

  const action = event.eventParts.find(part => part.type === "action")
  if (action) {
    const content = action.content as Record<string, unknown> | null
    const name = typeof content?.actionName === "string" ? content.actionName : ""
    const status = typeof content?.status === "string" ? content.status : ""
    if (name) return clip(status ? `${name} · ${status}` : name)
  }

  if (payload) {
    if (typeof payload.command === "string") return clip(`$ ${payload.command}`)
    if (typeof payload.message === "string") return clip(payload.message)
    if (Array.isArray(payload.files) && payload.files.length > 0) {
      const names = payload.files
        .map(file => file && typeof file === "object"
          ? (file as Record<string, unknown>).name
            ?? (file as Record<string, unknown>).filename
            ?? (file as Record<string, unknown>).path
          : undefined)
        .filter((name): name is string => typeof name === "string" && name.length > 0)
      const label = names.slice(0, 3).join(", ")
      const count = `${payload.files.length} file${payload.files.length === 1 ? "" : "s"}`
      return clip(label ? `${count} · ${label}` : count)
    }
    for (const key of ["records", "rows", "items"] as const) {
      if (Array.isArray(payload[key])) return `${payload[key].length} ${key}`
    }
    for (const key of ["repository", "url", "path", "branch", "name", "datasetId", "error"] as const) {
      if (typeof payload[key] === "string" && payload[key]) return clip(payload[key])
    }
  }

  return ""
}

function clip(value: string, size = 62) {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > size ? `${text.slice(0, size - 3)}...` : text
}

function clock(value: string | Date | undefined) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value))
}

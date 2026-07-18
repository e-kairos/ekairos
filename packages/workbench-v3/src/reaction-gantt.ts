import type {
  ContextReactionForUI,
  ContextSessionForUI,
} from "@ekairos/events/react"

import { reactionTitle } from "./reaction-graph"

export type ReactionGanttRow = Readonly<{
  id: string
  kind: "workflow" | "reaction"
  label: string
  status: ContextSessionForUI["status"] | ContextReactionForUI["status"]
  depth: number
  startMs: number
  endMs: number
  durationMs: number
  offsetPercent: number
  widthPercent: number
  reaction: ContextReactionForUI | null
}>

export type ReactionGantt = Readonly<{
  startMs: number
  endMs: number
  durationMs: number
  rows: readonly ReactionGanttRow[]
}>

export function buildReactionGantt(
  session: ContextSessionForUI,
  now = Date.now(),
): ReactionGantt {
  const startMs = dateMs(session.createdAt, now)
  const endMs = Math.max(startMs, session.updatedAt ? dateMs(session.updatedAt, now) : now)
  const durationMs = Math.max(1, endMs - startMs)
  const rows: ReactionGanttRow[] = [row({
    id: session.id,
    kind: "workflow",
    label: session.definition,
    status: session.status,
    depth: 0,
    startMs,
    endMs,
    reaction: null,
  }, startMs, durationMs)]

  collectReactionRows(session, 0, rows, startMs, durationMs, now, true)
  return Object.freeze({
    startMs,
    endMs,
    durationMs: Math.max(0, endMs - startMs),
    rows: Object.freeze(rows),
  })
}

function collectReactionRows(
  session: ContextSessionForUI,
  sessionDepth: number,
  rows: ReactionGanttRow[],
  workflowStartMs: number,
  workflowDurationMs: number,
  now: number,
  rootSession: boolean,
) {
  const rootId = session.rootReaction?.id
  for (const reaction of session.reactions) {
    if (rootSession && reaction.id === rootId) continue
    const startMs = dateMs(reaction.createdAt, workflowStartMs)
    const endMs = Math.max(
      startMs,
      reaction.updatedAt ? dateMs(reaction.updatedAt, now) : now,
    )
    rows.push(row({
      id: reaction.id,
      kind: "reaction",
      label: reactionTitle(reaction),
      status: reaction.status,
      depth: sessionDepth + (reaction.id === rootId ? 1 : 2),
      startMs,
      endMs,
      reaction,
    }, workflowStartMs, workflowDurationMs))
  }
  for (const child of session.children) {
    collectReactionRows(
      child,
      sessionDepth + 1,
      rows,
      workflowStartMs,
      workflowDurationMs,
      now,
      false,
    )
  }
}

function row(
  input: Omit<ReactionGanttRow, "durationMs" | "offsetPercent" | "widthPercent">,
  workflowStartMs: number,
  workflowDurationMs: number,
): ReactionGanttRow {
  const durationMs = Math.max(0, input.endMs - input.startMs)
  const offsetPercent = clamp(
    ((input.startMs - workflowStartMs) / workflowDurationMs) * 100,
    0,
    100,
  )
  const available = Math.max(0, 100 - offsetPercent)
  const widthPercent = Math.min(
    available,
    Math.max(input.kind === "workflow" ? available : 0.8, (durationMs / workflowDurationMs) * 100),
  )
  return Object.freeze({
    ...input,
    durationMs,
    offsetPercent,
    widthPercent,
  })
}

function dateMs(value: string | Date, fallback: number) {
  const result = new Date(value).valueOf()
  return Number.isFinite(result) ? result : fallback
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

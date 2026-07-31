import type {
  ContextEventForUI,
  ContextReactionForUI,
  ContextSessionForUI,
} from "@ekairos/events/react"

// Canonical source for the Ekairos reaction-graph registry item.
export type TimelineRow = Readonly<{
  event: ContextEventForUI
  lane: number
  producer: ContextReactionForUI | null
  child: boolean
  branch: number
  branchOf: string | null
}>

export type TimelineEdge = Readonly<{
  id: string
  reactionId: string
  from: string
  to: string
  kind: "flow" | "spawn"
}>

export type EventTimeline = Readonly<{
  rows: readonly TimelineRow[]
  edges: readonly TimelineEdge[]
  lanes: number
}>

const MAX_LANES = 5

// Chronological Event log rendered as a git-style graph. Edges are the real
// cause->effect connections of each Reaction; every non-trigger Event is
// guaranteed an incoming edge (soft "spawn" ones for Events no Reaction
// produces), so every line traces back to the trigger. Lanes come from a
// fixed pool: a line keeps its lane until its last child, continuations
// inherit it, fan-out siblings take the nearest free lane, and convergences
// land on the central lane of their parents.
export function buildEventTimeline(session: ContextSessionForUI): EventTimeline {
  const rootId = session.rootReaction?.id
  const sessions = collectSessions(session)
  const allReactions = uniqueReactions(sessions.flatMap(row => row.reactions))
    .sort((left, right) => left.position - right.position)
  const reactions = allReactions.filter(reaction => reaction.id !== rootId)
  const events = new Map<string, ContextEventForUI>()
  for (const row of sessions) {
    if (row.trigger) events.set(row.trigger.id, row.trigger)
  }
  for (const reaction of reactions) {
    reaction.causes.forEach(event => events.set(event.id, event))
    reaction.effects.forEach(event => events.set(event.id, event))
    reaction.liveEffects.forEach(event => events.set(event.id, event))
  }

  const producers = new Map<string, ContextReactionForUI>()
  for (const reaction of reactions) {
    const effects = reaction.effects.length > 0 ? reaction.effects : reaction.liveEffects
    for (const effect of effects) {
      if (!producers.has(effect.id)) producers.set(effect.id, reaction)
    }
  }

  const branches = new Map<string, number>()
  const branchStarts = new Map<string, string>()
  const sessionByTrigger = new Map<string, ContextSessionForUI>()
  sessions.forEach((row, index) => {
    if (index === 0) return
    if (row.trigger) {
      branchStarts.set(row.trigger.id, row.definition)
      sessionByTrigger.set(row.trigger.id, row)
      if (!branches.has(row.trigger.id)) branches.set(row.trigger.id, index)
    }
    for (const reaction of row.reactions) {
      for (const effect of [...reaction.effects, ...reaction.liveEffects]) {
        if (!branches.has(effect.id)) branches.set(effect.id, index)
      }
    }
  })

  const ordered = [...events.values()].sort(eventOrder)
  const indexOf = new Map(ordered.map((event, index) => [event.id, index]))

  const edges: TimelineEdge[] = []
  for (const reaction of reactions) {
    const sources = reaction.causeIds.filter(id => indexOf.has(id))
    const effects = (reaction.effects.length > 0 ? reaction.effects : reaction.liveEffects)
      .map(event => event.id)
      .filter(id => indexOf.has(id))
    if (sources.length === 0 || effects.length === 0) continue
    const first = effects[0]!
    sources.forEach((source, index) => edges.push(Object.freeze({
      id: `${reaction.id}:cause:${index}`,
      reactionId: reaction.id,
      from: source,
      to: first,
      kind: "flow" as const,
    })))
    for (let index = 1; index < effects.length; index += 1) {
      edges.push(Object.freeze({
        id: `${reaction.id}:effect:${index}`,
        reactionId: reaction.id,
        from: effects[index - 1]!,
        to: effects[index]!,
        kind: "flow" as const,
      }))
    }
  }

  // Guarantee connectivity back to the trigger: any Event without an incoming
  // edge hangs off its spawning Reaction when resolvable, otherwise off the
  // newest preceding main-line Event.
  const hasIncoming = new Set(edges.map(edge => edge.to))
  ordered.forEach((event, index) => {
    if (index === 0 || hasIncoming.has(event.id)) return
    let anchor: ContextEventForUI | undefined
    let reactionId = ""
    const owner = sessionByTrigger.get(event.id)
    const parent = owner
      ? allReactions.find(reaction => reaction.id === owner.parentReactionId)
      : undefined
    if (parent) {
      const at = new Date(event.createdAt).valueOf()
      anchor = [...parent.causes, ...parent.effects, ...parent.liveEffects]
        .filter(candidate => indexOf.has(candidate.id) && candidate.id !== event.id)
        .filter(candidate => new Date(candidate.createdAt).valueOf() <= at)
        .sort(eventOrder)
        .at(-1)
      reactionId = parent.id
    }
    if (!anchor) {
      for (let back = index - 1; back >= 0; back -= 1) {
        const candidate = ordered[back]!
        if ((branches.get(candidate.id) ?? 0) === 0) { anchor = candidate; break }
      }
      anchor ??= ordered[index - 1]
    }
    if (!anchor) return
    edges.push(Object.freeze({
      id: `${event.id}:spawn`,
      reactionId: reactionId || producers.get(anchor.id)?.id || "",
      from: anchor.id,
      to: event.id,
      kind: "spawn" as const,
    }))
    hasIncoming.add(event.id)
  })

  const childrenOf = new Map<string, number[]>()
  const parentsOf = new Map<string, string[]>()
  for (const edge of edges) {
    childrenOf.set(edge.from, [...(childrenOf.get(edge.from) ?? []), indexOf.get(edge.to)!])
    if (!(parentsOf.get(edge.to) ?? []).includes(edge.from)) {
      parentsOf.set(edge.to, [...(parentsOf.get(edge.to) ?? []), edge.from])
    }
  }
  const lastChild = (id: string) =>
    Math.max(indexOf.get(id) ?? 0, ...(childrenOf.get(id) ?? []))

  const laneOf = new Map<string, number>()
  const busyUntil = Array<number>(MAX_LANES).fill(-1)
  const freeLane = (preferred: number, index: number) => {
    let best = -1
    let bestDistance = Infinity
    for (let lane = 0; lane < busyUntil.length; lane += 1) {
      if (busyUntil[lane]! >= index) continue
      const distance = Math.abs(lane - preferred)
      if (distance < bestDistance) { best = lane; bestDistance = distance }
    }
    return best >= 0 ? best : busyUntil.indexOf(Math.min(...busyUntil))
  }
  ordered.forEach((event, index) => {
    const parents = (parentsOf.get(event.id) ?? []).filter(id => laneOf.has(id))
    let lane: number
    if (parents.length === 0) {
      lane = freeLane(0, index)
    } else if (parents.length === 1) {
      const parentLane = laneOf.get(parents[0]!)!
      lane = lastChild(parents[0]!) === index ? parentLane : freeLane(parentLane, index)
    } else {
      const parentLanes = parents.map(id => laneOf.get(id)!).sort((left, right) => left - right)
      const center = parentLanes[Math.floor(parentLanes.length / 2)]!
      const centerParent = parents.find(id => laneOf.get(id) === center)!
      lane = lastChild(centerParent) === index ? center : freeLane(center, index)
    }
    laneOf.set(event.id, lane)
    busyUntil[lane] = Math.max(busyUntil[lane]!, lastChild(event.id))
  })

  return Object.freeze({
    rows: Object.freeze(ordered.map(event => Object.freeze({
      event,
      lane: laneOf.get(event.id) ?? 0,
      producer: producers.get(event.id) ?? null,
      child: branches.has(event.id),
      branch: branches.get(event.id) ?? 0,
      branchOf: branchStarts.get(event.id) ?? null,
    }))),
    edges: Object.freeze(edges),
    lanes: Math.max(1, ...[...laneOf.values()].map(lane => lane + 1)),
  })
}

export function reactionTitle(reaction: ContextReactionForUI) {
  if (reaction.type === "emit") {
    return `Publish ${shortType(reaction.effects[0]?.type ?? reaction.liveEffects[0]?.type ?? "Event")}`
  }
  if (reaction.type === "action") {
    const name = [...reaction.effects, ...reaction.liveEffects]
      .map(actionName)
      .find(Boolean)
    return name ? `Execute ${name}` : "Execute domain action"
  }
  if (reaction.type === "dataset") return "Materialize formal Dataset"
  if (reaction.type === "agent") return firstSentence(reaction.instruction) || "Run model inference"
  if (reaction.type === "child") return reaction.instruction || "Run child Reaction"
  return reaction.instruction || reaction.type
}

export function reactionDurationMs(reaction: ContextReactionForUI) {
  const start = new Date(reaction.createdAt).valueOf()
  const finish = reaction.updatedAt ? new Date(reaction.updatedAt).valueOf() : Date.now()
  return Number.isFinite(start) && Number.isFinite(finish) ? Math.max(0, finish - start) : null
}

function actionName(event: ContextEventForUI | null | undefined) {
  for (const part of event?.eventParts ?? []) {
    if (part.type !== "action") continue
    const content = part.content as Record<string, unknown>
    if (typeof content.actionName === "string") return content.actionName
  }
  return ""
}

function shortType(type: string) {
  const pieces = type.split(".")
  return pieces[pieces.length - 1] || type
}

function firstSentence(value: string | undefined) {
  const text = String(value ?? "").trim()
  if (!text) return ""
  const end = text.search(/[.!?](?:\s|$)/)
  return (end >= 0 ? text.slice(0, end) : text).trim()
}

function eventOrder(left: ContextEventForUI, right: ContextEventForUI) {
  const created = new Date(left.createdAt).valueOf() - new Date(right.createdAt).valueOf()
  return created || left.id.localeCompare(right.id)
}

function collectSessions(session: ContextSessionForUI): ContextSessionForUI[] {
  return [session, ...session.children.flatMap(collectSessions)]
}

function uniqueReactions(reactions: readonly ContextReactionForUI[]) {
  return [...new Map(reactions.map(reaction => [reaction.id, reaction])).values()]
}

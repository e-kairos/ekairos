import type { EventTimeline } from "../../packages/registry/components/ekairos/reactions/reaction-graph.ts"

export type ReactionNavigationDirection = "up" | "down" | "left" | "right"

export type ReactionNavigationNode = Readonly<{
  id: string
  lane: number
  index: number
  parentIds: readonly string[]
  childIds: readonly string[]
  fanIn: number
  fanOut: number
}>

export type ReactionNavigator = Readonly<{
  node(id: string): ReactionNavigationNode | null
  move(id: string, direction: ReactionNavigationDirection): string
  activeBranch(id: string): ReadonlySet<string>
}>

export function createReactionNavigator(timeline: EventTimeline): ReactionNavigator {
  const rows = new Map(timeline.rows.map((row, index) => [row.event.id, {
    id: row.event.id,
    lane: row.lane,
    index,
  }]))
  const parents = new Map<string, Set<string>>()
  const children = new Map<string, Set<string>>()
  for (const edge of timeline.edges) {
    if (!rows.has(edge.from) || !rows.has(edge.to)) continue
    parents.set(edge.to, new Set([...(parents.get(edge.to) ?? []), edge.from]))
    children.set(edge.from, new Set([...(children.get(edge.from) ?? []), edge.to]))
  }

  const ordered = (ids: Iterable<string>) => [...ids]
    .filter(id => rows.has(id))
    .sort((left, right) => rows.get(left)!.index - rows.get(right)!.index)

  const node = (id: string): ReactionNavigationNode | null => {
    const row = rows.get(id)
    if (!row) return null
    const parentIds = Object.freeze(ordered(parents.get(id) ?? []))
    const childIds = Object.freeze(ordered(children.get(id) ?? []))
    return Object.freeze({
      ...row,
      parentIds,
      childIds,
      fanIn: parentIds.length,
      fanOut: childIds.length,
    })
  }

  const nearest = (currentId: string, ids: readonly string[]) => {
    const current = rows.get(currentId)!
    return [...ids].sort((left, right) => {
      const leftRow = rows.get(left)!
      const rightRow = rows.get(right)!
      const leftSameLane = leftRow.lane === current.lane ? 0 : 1
      const rightSameLane = rightRow.lane === current.lane ? 0 : 1
      return leftSameLane - rightSameLane
        || Math.abs(leftRow.lane - current.lane) - Math.abs(rightRow.lane - current.lane)
        || Math.abs(leftRow.index - current.index) - Math.abs(rightRow.index - current.index)
        || leftRow.index - rightRow.index
    })[0]
  }

  const horizontal = (currentId: string, direction: "left" | "right") => {
    const current = rows.get(currentId)!
    const candidates = new Set<string>()
    const parentIds = ordered(parents.get(currentId) ?? [])
    const childIds = ordered(children.get(currentId) ?? [])

    if (parentIds.length > 1) parentIds.forEach(id => candidates.add(id))
    if (childIds.length > 1) childIds.forEach(id => candidates.add(id))
    for (const parentId of parentIds) {
      for (const siblingId of children.get(parentId) ?? []) candidates.add(siblingId)
    }
    for (const childId of childIds) {
      for (const siblingId of parents.get(childId) ?? []) candidates.add(siblingId)
    }
    candidates.delete(currentId)

    const currentColumn = timeline.lanes - 1 - current.lane
    const directional = [...candidates].filter(id => {
      const column = timeline.lanes - 1 - rows.get(id)!.lane
      return direction === "left" ? column < currentColumn : column > currentColumn
    })
    const sorted = directional.sort((left, right) => {
      const leftRow = rows.get(left)!
      const rightRow = rows.get(right)!
      const leftColumn = timeline.lanes - 1 - leftRow.lane
      const rightColumn = timeline.lanes - 1 - rightRow.lane
      return Math.abs(leftColumn - currentColumn) - Math.abs(rightColumn - currentColumn)
        || Math.abs(leftRow.index - current.index) - Math.abs(rightRow.index - current.index)
        || leftRow.index - rightRow.index
    })
    if (sorted[0]) return sorted[0]

    return [...candidates]
      .filter(id => rows.get(id)!.lane === current.lane)
      .sort((left, right) =>
        Math.abs(rows.get(left)!.index - current.index)
          - Math.abs(rows.get(right)!.index - current.index)
        || rows.get(left)!.index - rows.get(right)!.index)[0]
  }

  const move = (id: string, direction: ReactionNavigationDirection): string => {
    if (!rows.has(id)) return timeline.rows.at(-1)?.event.id ?? id
    const current = node(id)!
    if (direction === "up") return nearest(id, current.parentIds) ?? id
    if (direction === "down") return nearest(id, current.childIds) ?? id
    return horizontal(id, direction) ?? id
  }

  const activeBranch = (id: string): ReadonlySet<string> => {
    if (!rows.has(id)) return new Set()
    const active = new Set<string>()
    const collect = (eventId: string, relations: Map<string, Set<string>>, seen: Set<string>) => {
      if (seen.has(eventId)) return
      seen.add(eventId)
      active.add(eventId)
      for (const relatedId of relations.get(eventId) ?? []) collect(relatedId, relations, seen)
    }
    collect(id, parents, new Set())
    collect(id, children, new Set())
    return active
  }

  return Object.freeze({ node, move, activeBranch })
}

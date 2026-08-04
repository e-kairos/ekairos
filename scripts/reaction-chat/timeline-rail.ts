import type { EventTimeline } from "../../packages/registry/components/ekairos/reactions/reaction-graph.ts"

type Direction = "up" | "down" | "left" | "right"

export type TimelineRail = Readonly<{
  width: number
  lines: readonly string[]
  activeLines: readonly string[]
}>

export function buildTimelineRail(
  timeline: EventTimeline,
  rowHeights: readonly number[],
  activeEventIds: ReadonlySet<string> = new Set(),
): TimelineRail {
  if (rowHeights.length !== timeline.rows.length) {
    throw new Error("timeline_rail_row_height_count_mismatch")
  }
  if (rowHeights.some(height => !Number.isInteger(height) || height < 1)) {
    throw new Error("timeline_rail_row_height_invalid")
  }

  const lanes = Math.max(1, timeline.lanes)
  const width = lanes * 2 - 1
  const rowStarts: number[] = []
  let lineCount = 0
  for (const height of rowHeights) {
    rowStarts.push(lineCount)
    lineCount += height
  }
  const cells = Array.from({ length: lineCount }, () =>
    Array.from({ length: width }, () => new Set<Direction>()),
  )
  const activeCells = Array.from({ length: lineCount }, () =>
    Array.from({ length: width }, () => new Set<Direction>()),
  )
  const dots = new Map<number, number>()
  const activeDots = new Map<number, number>()
  const rowIndex = new Map(timeline.rows.map((row, index) => [row.event.id, index]))
  const column = (lane: number) => (lanes - 1 - lane) * 2
  const connect = (
    target: Array<Array<Set<Direction>>>,
    x: number,
    y: number,
    ...directions: Direction[]
  ) => {
    if (!target[y]?.[x]) return
    directions.forEach(direction => target[y]![x]!.add(direction))
  }

  timeline.rows.forEach((row, index) => {
    const x = column(row.lane)
    const start = rowStarts[index]!
    dots.set(start, x)
    if (activeEventIds.has(row.event.id)) activeDots.set(start, x)
    for (let y = start + 1; y < start + rowHeights[index]!; y += 1) {
      connect(cells, x, y, "up", "down")
      if (activeEventIds.has(row.event.id)) {
        connect(activeCells, x, y, "up", "down")
      }
    }
  })

  const drawEdge = (target: Array<Array<Set<Direction>>>, edge: EventTimeline["edges"][number]) => {
    const fromIndex = rowIndex.get(edge.from)
    const toIndex = rowIndex.get(edge.to)
    if (fromIndex === undefined || toIndex === undefined || fromIndex >= toIndex) return
    const fromX = column(timeline.rows[fromIndex]!.lane)
    const toX = column(timeline.rows[toIndex]!.lane)
    const fromY = rowStarts[fromIndex]!
    const toY = rowStarts[toIndex]!
    connect(target, fromX, fromY, "down")
    for (let y = fromY + 1; y < toY; y += 1) {
      connect(target, fromX, y, "up", "down")
    }
    connect(target, fromX, toY, "up")
    if (fromX !== toX) {
      const left = Math.min(fromX, toX)
      const right = Math.max(fromX, toX)
      for (let x = left; x <= right; x += 1) {
        if (x > left) connect(target, x, toY, "left")
        if (x < right) connect(target, x, toY, "right")
      }
    }
  }

  for (const edge of timeline.edges) {
    drawEdge(cells, edge)
    if (activeEventIds.has(edge.from) && activeEventIds.has(edge.to)) {
      drawEdge(activeCells, edge)
    }
  }

  const render = (
    target: Array<Array<Set<Direction>>>,
    targetDots: Map<number, number>,
  ) => target.map((row, y) => row.map((directions, x) =>
    targetDots.get(y) === x ? "●" : railCharacter(directions),
  ).join(""))
  return Object.freeze({
    width,
    lines: Object.freeze(render(cells, dots)),
    activeLines: Object.freeze(render(activeCells, activeDots)),
  })
}

function railCharacter(directions: ReadonlySet<Direction>): string {
  const up = directions.has("up")
  const down = directions.has("down")
  const left = directions.has("left")
  const right = directions.has("right")
  if (up && down && left && right) return "┼"
  if (up && down && left) return "┤"
  if (up && down && right) return "├"
  if (left && right && up) return "┴"
  if (left && right && down) return "┬"
  if (down && right) return "┌"
  if (down && left) return "┐"
  if (up && right) return "└"
  if (up && left) return "┘"
  if (up || down) return "│"
  if (left || right) return "─"
  return " "
}

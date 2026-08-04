export type TerminalViewportRow<T> = Readonly<{
  rowIndex: number
  lines: readonly T[]
}>

export type TerminalViewport<T> = Readonly<{
  hiddenRows: number
  rows: readonly TerminalViewportRow<T>[]
}>

export type CenteredTerminalViewport<T> = Readonly<{
  hiddenBefore: number
  hiddenAfter: number
  rows: readonly TerminalViewportRow<T>[]
}>

export function limitRowLines<T>(
  lines: readonly T[],
  maxLines: number,
  overflowLine: (hiddenLines: number) => T,
): readonly T[] {
  const limit = Math.max(1, Math.trunc(maxLines))
  if (lines.length <= limit) return lines
  if (limit === 1) return Object.freeze([lines[0]!])
  return Object.freeze([
    ...lines.slice(0, limit - 1),
    overflowLine(lines.length - limit + 1),
  ])
}

export function selectTerminalViewport<T>(
  rows: readonly (readonly T[])[],
  maxLines: number,
): TerminalViewport<T> {
  const limit = Math.max(1, Math.trunc(maxLines))
  const total = rows.reduce((sum, lines) => sum + lines.length, 0)
  if (total <= limit) {
    return Object.freeze({
      hiddenRows: 0,
      rows: Object.freeze(rows.map((lines, rowIndex) =>
        Object.freeze({ rowIndex, lines }))),
    })
  }

  const contentBudget = Math.max(1, limit - 1)
  const selected: TerminalViewportRow<T>[] = []
  let used = 0
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const lines = rows[rowIndex]!
    if (used + lines.length > contentBudget) break
    selected.unshift(Object.freeze({ rowIndex, lines }))
    used += lines.length
  }

  if (selected.length === 0 && rows.length > 0) {
    const rowIndex = rows.length - 1
    selected.push(Object.freeze({
      rowIndex,
      lines: Object.freeze(rows[rowIndex]!.slice(0, contentBudget)),
    }))
  }

  return Object.freeze({
    hiddenRows: selected[0]?.rowIndex ?? rows.length,
    rows: Object.freeze(selected),
  })
}

export function selectCenteredTerminalViewport<T>(
  rows: readonly (readonly T[])[],
  anchorIndex: number,
  maxLines: number,
): CenteredTerminalViewport<T> {
  if (rows.length === 0) {
    return Object.freeze({ hiddenBefore: 0, hiddenAfter: 0, rows: Object.freeze([]) })
  }
  const limit = Math.max(1, Math.trunc(maxLines))
  const anchor = Math.max(0, Math.min(rows.length - 1, Math.trunc(anchorIndex)))
  let start = anchor
  let end = anchor
  let used = rows[anchor]!.length
  let preferBefore = true

  const total = (nextStart: number, nextEnd: number, nextUsed: number) =>
    nextUsed + (nextStart > 0 ? 1 : 0) + (nextEnd < rows.length - 1 ? 1 : 0)
  const tryBefore = () => {
    if (start === 0) return false
    const next = start - 1
    if (total(next, end, used + rows[next]!.length) > limit) return false
    start = next
    used += rows[next]!.length
    return true
  }
  const tryAfter = () => {
    if (end === rows.length - 1) return false
    const next = end + 1
    if (total(start, next, used + rows[next]!.length) > limit) return false
    end = next
    used += rows[next]!.length
    return true
  }

  while (true) {
    const added = preferBefore
      ? tryBefore() || tryAfter()
      : tryAfter() || tryBefore()
    if (!added) break
    preferBefore = !preferBefore
  }

  return Object.freeze({
    hiddenBefore: start,
    hiddenAfter: rows.length - end - 1,
    rows: Object.freeze(rows.slice(start, end + 1).map((lines, offset) =>
      Object.freeze({ rowIndex: start + offset, lines }))),
  })
}

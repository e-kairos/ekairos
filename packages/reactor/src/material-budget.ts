const MAX_STRING_CHARS = 512
const MAX_ARRAY_ITEMS = 24
const MAX_DEPTH = 8

export const DATASET_PREVIEW_ROW_CHARS = 2_048
export const DATASET_PREVIEW_TOTAL_CHARS = 40_960
export const DATASET_READ_ROW_CHARS = 16_384
export const DATASET_READ_TOTAL_CHARS = 131_072

export type BoundedRows = Readonly<{
  rows: readonly unknown[]
  included: number
  truncated: boolean
}>

export function compactJsonValue(value: unknown, maxChars: number): unknown {
  const rendered = safeStringify(value)
  if (rendered.length <= maxChars) return value
  const reduced = reduceValue(value, 0)
  const reducedRendered = safeStringify(reduced)
  if (reducedRendered.length <= maxChars) return reduced
  return `${reducedRendered.slice(0, Math.max(0, maxChars - 256))}...[truncated]`
}

export function boundRows(
  rows: readonly unknown[],
  budget: Readonly<{ rowChars: number; totalChars: number }>,
): BoundedRows {
  const bounded: unknown[] = []
  let spent = 0
  for (const row of rows) {
    const compact = compactJsonValue(row, budget.rowChars)
    const cost = safeStringify(compact).length
    if (bounded.length > 0 && spent + cost > budget.totalChars) break
    bounded.push(compact)
    spent += cost
  }
  return Object.freeze({
    rows: Object.freeze(bounded),
    included: bounded.length,
    truncated: bounded.length < rows.length ||
      bounded.some((row, index) => row !== rows[index]),
  })
}

function reduceValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.length <= MAX_STRING_CHARS
      ? value
      : `${value.slice(0, MAX_STRING_CHARS)}...[truncated]`
  }
  if (!value || typeof value !== "object") return value
  if (value instanceof Date) return value
  if (depth >= MAX_DEPTH) return "[depth-truncated]"
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map(item =>
      reduceValue(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`...[${value.length - MAX_ARRAY_ITEMS} more]`)
    }
    return items
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, reduceValue(item, depth + 1)]),
  )
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

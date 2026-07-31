import { describe, expect, it } from "vitest"

import {
  DATASET_PREVIEW_ROW_CHARS,
  DATASET_PREVIEW_TOTAL_CHARS,
  boundRows,
  compactJsonValue,
} from "../material-budget.js"

function obeseRow(index: number) {
  return {
    id: `row-${index}`,
    kind: "goal",
    time: index * 10,
    snapshot: {
      players: Array.from({ length: 40 }, (_, player) => ({
        name: `player-${player}`,
        position: { x: player * 1.5, y: player * 2.5, z: player * 3.5 },
        trail: Array.from({ length: 60 }, (_, i) => i * 0.01),
      })),
    },
  }
}

describe("compactJsonValue", () => {
  it("keeps small values untouched", () => {
    const value = { kind: "goal", time: 152.79 }
    expect(compactJsonValue(value, 2_048)).toBe(value)
  })

  it("reduces obese values below the requested budget", () => {
    const compact = compactJsonValue(obeseRow(1), DATASET_PREVIEW_ROW_CHARS)
    expect(JSON.stringify(compact).length)
      .toBeLessThanOrEqual(DATASET_PREVIEW_ROW_CHARS)
  })

  it("preserves shallow fields when reducing structure", () => {
    const compact = compactJsonValue(obeseRow(2), 8_192) as Record<string, unknown>
    expect(compact.kind).toBe("goal")
    expect(compact.time).toBe(20)
  })
})

describe("boundRows", () => {
  it("keeps compact row sets untouched", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ kind: "save", time: i }))
    const bounded = boundRows(rows, { rowChars: 2_048, totalChars: 40_960 })
    expect(bounded.rows).toHaveLength(20)
    expect(bounded.truncated).toBe(false)
    expect(bounded.rows[3]).toBe(rows[3])
  })

  it("bounds obese row sets under the total budget", () => {
    const rows = Array.from({ length: 20 }, (_, i) => obeseRow(i))
    const bounded = boundRows(rows, {
      rowChars: DATASET_PREVIEW_ROW_CHARS,
      totalChars: DATASET_PREVIEW_TOTAL_CHARS,
    })
    expect(bounded.truncated).toBe(true)
    expect(JSON.stringify(bounded.rows).length)
      .toBeLessThanOrEqual(DATASET_PREVIEW_TOTAL_CHARS + DATASET_PREVIEW_ROW_CHARS)
    expect(bounded.rows.length).toBeGreaterThan(0)
  })

  it("always includes at least the first row", () => {
    const bounded = boundRows([obeseRow(0)], { rowChars: 128, totalChars: 64 })
    expect(bounded.included).toBe(1)
  })
})

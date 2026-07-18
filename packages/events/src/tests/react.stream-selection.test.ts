import { describe, expect, it } from "vitest"

import { selectReactionsForStreaming } from "../react.stream-selection.js"

function reaction(id: string, status: "running" | "completed" | "failed") {
  return { id, status } as any
}

describe("React Context stream selection", () => {
  const reactions = [
    reaction("running", "running"),
    reaction("selected", "completed"),
    reaction("historical", "completed"),
  ]

  it("preserves eager replay when no selection policy is supplied", () => {
    expect(selectReactionsForStreaming(reactions, undefined)).toBe(reactions)
  })

  it("always streams running Reactions and only selected history", () => {
    expect(selectReactionsForStreaming(reactions, ["selected"]).map(row => row.id))
      .toEqual(["running", "selected"])
  })

  it("can disable historical replay while retaining live streams", () => {
    expect(selectReactionsForStreaming(reactions, []).map(row => row.id))
      .toEqual(["running"])
  })
})

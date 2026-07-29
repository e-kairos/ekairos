/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  agentDatasetMaterializeInputSchema,
  agentDatasetPromptIndex,
  agentDatasetReadInputSchema,
  readAgentDatasetRows,
} from "../agent-dataset-runtime.js"

describe("Agent Dataset affordances", () => {
  it("defaults materialization to the causal given without a model-built source", () => {
    const parsed = agentDatasetMaterializeInputSchema.parse({
      title: "Relevant offers",
      instructions: "Normalize every offer row.",
    })
    const jsonSchema = z.toJSONSchema(agentDatasetMaterializeInputSchema)

    expect(parsed).not.toHaveProperty("source")
    expect(jsonSchema.required).toEqual(["title"])
    expect(jsonSchema.properties).not.toHaveProperty("source")
  })

  it("describes indexed datasets as discovery metadata that must be read", () => {
    const prompt = agentDatasetPromptIndex({
      domain: { name: "sales", entities: {} },
      given: { rows: [] },
      available: [{
        key: "dataset.materialized",
        datasetId: "sales_rows",
        title: "Sales rows",
        rowCount: 25,
        preview: [{ row: 1 }, { row: 2 }, { row: 3 }],
      }],
    } as any)

    expect(prompt).toContain('"rowCount": 25')
    expect(prompt).toContain("dataset.read")
    expect(prompt).toContain("never infer missing rows")
  })

  it("reads one compact filtered page and advances the source cursor", async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      index,
      team: index % 2 === 0 ? "blue" : "orange",
    }))
    const opened = {
      datasetId: "rows",
      mode: "opened" as const,
      previewRows: rows.slice(0, 3),
      reader: {
        async read(input: { cursor?: number; limit?: number } = {}) {
          const start = input.cursor ?? 0
          const page = rows.slice(start, start + (input.limit ?? 25))
          return {
            rows: page,
            cursor: start + page.length,
            done: start + page.length >= rows.length,
          }
        },
      },
    }
    const input = agentDatasetReadInputSchema.parse({
      datasetId: "rows",
      limit: 5,
      filter: { field: "team", equals: "orange" },
    })

    const result = await readAgentDatasetRows(opened, input)

    expect(result.rows).toHaveLength(5)
    expect(result.rows.every((row: any) => row.team === "orange")).toBe(true)
    expect(result.nextCursor).toBeGreaterThan(5)
  })
})

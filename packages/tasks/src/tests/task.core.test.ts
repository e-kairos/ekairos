import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  approvalOutcomeForCommand,
  createApprovalOutcome,
  parseTaskOutcome,
  taskOutcomeToken,
  toStoredOutcomeSchema,
} from "../index.ts"

const scoreOutcomeSchema = z.object({
  score: z.number().int(),
  label: z.string(),
})

describe("task public primitives", () => {
  it("uses deterministic workflow hook tokens", () => {
    expect(taskOutcomeToken("task_123")).toBe("ekairos_task:outcome:task_123")
    expect(() => taskOutcomeToken("")).toThrow("Task id is required.")
  })

  it("parses typed outcomes through the declared schema", () => {
    expect(parseTaskOutcome(scoreOutcomeSchema, {
      score: 9,
      label: "ready",
    })).toEqual({
      score: 9,
      label: "ready",
    })
    expect(() =>
      parseTaskOutcome(scoreOutcomeSchema, {
        score: "9",
        label: "ready",
      }),
    ).toThrow()
  })

  it("stores outcome schemas as durable JSON schema", () => {
    expect(toStoredOutcomeSchema(scoreOutcomeSchema)).toMatchObject({
      type: "json-schema",
      schema: {
        type: "object",
        required: ["score", "label"],
      },
    })
  })
})

describe("approval outcome preset", () => {
  it("maps approval commands to typed outcomes", () => {
    expect(approvalOutcomeForCommand("approve")).toBe("approved")
    expect(approvalOutcomeForCommand("reject")).toBe("rejected")
  })

  it("requires a rejection reason", () => {
    expect(() =>
      createApprovalOutcome({
        outcome: "rejected",
        approved: false,
        reason: "",
      }),
    ).toThrow()
  })

  it("parses approved outcomes", () => {
    expect(createApprovalOutcome({
      outcome: "approved",
      approved: true,
    })).toEqual({
      outcome: "approved",
      approved: true,
    })
  })
})

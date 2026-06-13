import { describe, expect, it } from "vitest"
import {
  annotateNotationEvidence,
  evaluateNotationCheck,
  inferQueryNotation,
  reviseDatasetNotation,
  type NotationCheck,
} from "../notation.js"

const ROWS = [
  { orderId: "o1", region: "NOA", amount: 100, paid: true },
  { orderId: "o2", region: "NEA", amount: 250.5, paid: true },
  { orderId: "o3", region: "NOA", amount: 49.5, paid: false },
]

describe("notation checks (arithmetic)", () => {
  it("row_count compares cardinality", () => {
    expect(evaluateNotationCheck(ROWS, { kind: "row_count", op: "=", value: 3 }).ok).toBe(true)
    expect(evaluateNotationCheck(ROWS, { kind: "row_count", op: ">", value: 5 }).ok).toBe(false)
  })

  it("field_type quantifies over all rows", () => {
    expect(
      evaluateNotationCheck(ROWS, { kind: "field_type", field: "amount", type: "number" }).ok,
    ).toBe(true)
    expect(
      evaluateNotationCheck(ROWS, { kind: "field_type", field: "region", type: "number" }).ok,
    ).toBe(false)
  })

  it("field_range and aggregates evaluate arithmetic claims", () => {
    expect(
      evaluateNotationCheck(ROWS, { kind: "field_range", field: "amount", min: 0 }).ok,
    ).toBe(true)
    expect(
      evaluateNotationCheck(ROWS, {
        kind: "aggregate",
        fn: "sum",
        field: "amount",
        op: "=",
        value: 400,
        tolerance: 0.001,
      }).ok,
    ).toBe(true)
    expect(
      evaluateNotationCheck(ROWS, {
        kind: "aggregate",
        fn: "max",
        field: "amount",
        op: "<=",
        value: 200,
      }).ok,
    ).toBe(false)
  })

  it("unique detects key violations", () => {
    expect(evaluateNotationCheck(ROWS, { kind: "unique", fields: ["orderId"] }).ok).toBe(true)
    expect(evaluateNotationCheck(ROWS, { kind: "unique", fields: ["region"] }).ok).toBe(false)
  })

  it("dot-paths reach nested fields", () => {
    const nested = [{ company: { taxId: "30-1" } }, { company: { taxId: "30-2" } }]
    expect(
      evaluateNotationCheck(nested, { kind: "field_nonnull", field: "company.taxId" }).ok,
    ).toBe(true)
  })

  it("propositional composition: implies is a material conditional", () => {
    const implication: NotationCheck = {
      kind: "implies",
      if: { kind: "row_count", op: ">", value: 0 },
      then: { kind: "field_range", field: "amount", min: 0 },
    }
    expect(evaluateNotationCheck(ROWS, implication).ok).toBe(true)

    const vacuous: NotationCheck = {
      kind: "implies",
      if: { kind: "row_count", op: ">", value: 100 },
      then: { kind: "field_range", field: "amount", min: 99999 },
    }
    expect(evaluateNotationCheck(ROWS, vacuous).ok).toBe(true)

    const broken: NotationCheck = {
      kind: "and",
      checks: [
        { kind: "row_count", op: "=", value: 3 },
        { kind: "not", check: { kind: "field_nonnull", field: "orderId" } },
      ],
    }
    expect(evaluateNotationCheck(ROWS, broken).ok).toBe(false)
  })
})

describe("notation lifecycle (iteration)", () => {
  it("revisions bump versions and keep the discovery trail", () => {
    const initial = reviseDatasetNotation(null, {
      latex: "D = \\{ r \\mid r \\in F \\}",
      symbols: [{ name: "D", kind: "set", description: "dataset" }],
      predicates: [],
      reason: "initial proposal",
    })
    expect(initial.version).toBe(1)
    expect(initial.status).toBe("proposed")

    const refined = reviseDatasetNotation(initial, {
      latex: "D = \\{ r \\mid r \\in F \\wedge r.amount > 0 \\}",
      reason: "discovered amount must be positive",
    })
    expect(refined.version).toBe(2)
    expect(refined.status).toBe("refined")
    expect(refined.history).toHaveLength(2)
    expect(refined.symbols).toHaveLength(1)

    const final = reviseDatasetNotation(refined, {
      latex: refined.latex,
      reason: "matches produced rows",
      final: true,
    })
    expect(final.status).toBe("final")
  })

  it("evidence annotation is advisory and never changes the formal status", () => {
    const notation = reviseDatasetNotation(null, {
      latex: "D",
      predicates: [
        {
          id: "card",
          description: "3 rows",
          latex: "|D| = 3",
          check: { kind: "row_count", op: "=", value: 3 },
        },
        // a semantic predicate: trusted, no mechanical check
        { id: "funny", description: "cada fila es una frase divertida", latex: "\\forall x \\in D:\\; \\text{divertida}(x)" },
      ],
      reason: "initial",
      final: true,
    })

    const annotated = annotateNotationEvidence(notation, ROWS)
    // formal lifecycle status is preserved — no verified/violated verdict
    expect(annotated.status).toBe("final")
    expect(annotated.checks).toEqual([
      expect.objectContaining({ predicateId: "card", status: "supported" }),
      expect.objectContaining({ predicateId: "funny", status: "asserted" }),
    ])

    // arithmetic evidence can contradict, but the notation stays "final"
    // (the dataset's validity is trusted, not voted down by a check)
    const contradicted = annotateNotationEvidence(notation, ROWS.slice(0, 2))
    expect(contradicted.status).toBe("final")
    expect(
      contradicted.checks?.find((c) => c.predicateId === "card")?.status,
    ).toBe("contradicted")
    expect(
      contradicted.checks?.find((c) => c.predicateId === "funny")?.status,
    ).toBe("asserted")
  })
})

describe("query-backed deterministic notation", () => {
  it("derives a final notation with arithmetic predicates from query + schema + rows", () => {
    const notation = inferQueryNotation({
      entityNames: ["order_orders"],
      rowCount: 3,
      schema: { schema: { orderId: "string", amount: "number" } },
      explanation: "paid orders snapshot",
    })
    expect(notation.status).toBe("final")
    expect(notation.latex).toContain("\\mathcal{D}")
    expect(notation.predicates.length).toBeGreaterThanOrEqual(2)

    // query datasets are the special case where the formal claims are fully
    // mechanical, so the evidence supports them — but status stays "final"
    const annotated = annotateNotationEvidence(notation, ROWS)
    expect(annotated.status).toBe("final")
    expect(annotated.checks?.every((c) => c.status === "supported")).toBe(true)
  })
})

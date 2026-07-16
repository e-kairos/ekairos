import { describe, expect, it } from "vitest"

import {
  flattenRow,
  neo4jValueToJson,
  normalizeNeo4jRecords,
  type Neo4jRecordLike,
} from "../sources/neo4j-normalize.js"

/** duck-typed neo4j Integer */
const int = (n: number) => ({ low: n, high: 0, toNumber: () => n })

/** duck-typed neo4j Node / Relationship */
const node = (labels: string[], properties: Record<string, unknown>) => ({
  identity: int(1),
  labels,
  properties,
})
const rel = (type: string, properties: Record<string, unknown>) => ({
  identity: int(2),
  type,
  properties,
})

function record(entries: Record<string, unknown>): Neo4jRecordLike {
  return {
    keys: Object.keys(entries),
    get: (key) => entries[String(key)],
  }
}

describe("neo4jValueToJson", () => {
  it("converts neo4j Integers to numbers", () => {
    expect(neo4jValueToJson(int(42))).toBe(42)
  })

  it("converts nodes to their properties plus _labels", () => {
    expect(neo4jValueToJson(node(["Supplier"], { name: "acme", rating: int(5) }))).toEqual({
      name: "acme",
      rating: 5,
      _labels: ["Supplier"],
    })
  })

  it("converts relationships to their properties plus _type", () => {
    expect(neo4jValueToJson(rel("BID_ON", { amount: 120 }))).toEqual({
      amount: 120,
      _type: "BID_ON",
    })
  })

  it("recurses arrays and plain objects, mapping undefined to null", () => {
    expect(neo4jValueToJson([int(1), { a: undefined }])).toEqual([1, { a: null }])
  })
})

describe("flattenRow", () => {
  it("flattens nested objects into dot-notation columns", () => {
    expect(flattenRow({ n: { name: "acme", city: { code: "BA" } }, total: 3 })).toEqual({
      "n.name": "acme",
      "n.city.code": "BA",
      total: 3,
    })
  })

  it("keeps arrays and nulls as-is", () => {
    expect(flattenRow({ tags: ["a", "b"], gone: null })).toEqual({
      tags: ["a", "b"],
      gone: null,
    })
  })
})

describe("normalizeNeo4jRecords", () => {
  it("normalizes records to flat plain rows (nodes → props, aplanado)", () => {
    const rows = normalizeNeo4jRecords([
      record({
        supplier: node(["Supplier"], { name: "acme", rating: int(5) }),
        bid: rel("BID_ON", { amount: int(120) }),
        total: int(2),
      }),
    ])
    expect(rows).toEqual([
      {
        "supplier.name": "acme",
        "supplier.rating": 5,
        "supplier._labels": ["Supplier"],
        "bid.amount": 120,
        "bid._type": "BID_ON",
        total: 2,
      },
    ])
  })

  it("returns empty for no records", () => {
    expect(normalizeNeo4jRecords([])).toEqual([])
  })
})

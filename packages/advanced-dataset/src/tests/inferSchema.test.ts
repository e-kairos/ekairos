import { describe, expect, it } from "vitest"

import { inferSchema } from "../schema.js"

describe("inferSchema", () => {
  it("infers primitive types in first-seen column order", () => {
    const schema = inferSchema([
      { name: "acme", offer: 120.5, active: true },
      { name: "globex", offer: 98, active: false },
    ])
    expect(schema).toEqual([
      { name: "name", type: "string" },
      { name: "offer", type: "number" },
      { name: "active", type: "boolean" },
    ])
  })

  it("detects dates from Date instances and ISO strings", () => {
    const schema = inferSchema([
      { created: new Date("2026-01-01T00:00:00Z"), day: "2026-01-01", at: "2026-01-01T10:30:00Z" },
    ])
    expect(schema).toEqual([
      { name: "created", type: "date" },
      { name: "day", type: "date" },
      { name: "at", type: "date" },
    ])
  })

  it("does not confuse regular strings with dates", () => {
    const schema = inferSchema([{ code: "LIC-4519", note: "2026 was a good year" }])
    expect(schema).toEqual([
      { name: "code", type: "string" },
      { name: "note", type: "string" },
    ])
  })

  it("ignores nulls when a later row defines the type", () => {
    const schema = inferSchema([
      { offer: null, name: "acme" },
      { offer: 120, name: null },
    ])
    expect(schema).toEqual([
      { name: "offer", type: "number" },
      { name: "name", type: "string" },
    ])
  })

  it("defaults all-null columns to string", () => {
    const schema = inferSchema([{ ghost: null }, { ghost: undefined }])
    expect(schema).toEqual([{ name: "ghost", type: "string" }])
  })

  it("widens mixed-type columns to string", () => {
    const schema = inferSchema([{ v: 1 }, { v: "two" }, { v: true }])
    expect(schema).toEqual([{ name: "v", type: "string" }])
  })

  it("types nested objects and arrays", () => {
    const schema = inferSchema([{ meta: { a: 1 }, tags: ["x", "y"] }])
    expect(schema).toEqual([
      { name: "meta", type: "object" },
      { name: "tags", type: "array" },
    ])
  })

  it("collects columns that appear only in later rows", () => {
    const schema = inferSchema([{ a: 1 }, { a: 2, b: "x" }])
    expect(schema).toEqual([
      { name: "a", type: "number" },
      { name: "b", type: "string" },
    ])
  })

  it("only samples the first N rows", () => {
    const rows = [{ v: 1 }, { v: "late-string" }]
    expect(inferSchema(rows, 1)).toEqual([{ name: "v", type: "number" }])
  })

  it("returns empty schema for no rows", () => {
    expect(inferSchema([])).toEqual([])
  })
})

import { describe, expect, it } from "vitest"

import {
  buildAggregateSql,
  buildEventsSelectSql,
  buildRowsCountSql,
  buildRowsSql,
  parseMetric,
  parseSort,
} from "../sql.js"

const DB = "default"
const DS = "ds_a1b"

describe("buildRowsSql", () => {
  it("builds the default query (whole JSON row, stable order, default limit)", () => {
    const { sql, params } = buildRowsSql({ database: DB, datasetId: DS })
    expect(sql).toBe(
      [
        "SELECT data",
        "FROM default.advanced_dataset_rows",
        "WHERE dataset_id = {datasetId:String}",
        "ORDER BY row_idx ASC",
        "LIMIT 1000 OFFSET 0",
      ].join("\n"),
    )
    expect(params).toEqual({ datasetId: DS })
  })

  it("pushes down select + numeric where + sort desc + limit/offset (with schema hints)", () => {
    const { sql, params } = buildRowsSql({
      database: DB,
      datasetId: DS,
      select: ["proveedor", "oferta"],
      where: { oferta: { op: "gt", value: 100 } },
      sort: "oferta:desc",
      limit: 200,
      offset: 40,
      schema: [
        { name: "proveedor", type: "string" },
        { name: "oferta", type: "number" },
      ],
    })
    expect(sql).toBe(
      [
        "SELECT JSONExtractRaw(data, 'proveedor') AS `proveedor`, JSONExtractRaw(data, 'oferta') AS `oferta`",
        "FROM default.advanced_dataset_rows",
        "WHERE dataset_id = {datasetId:String} AND JSONExtract(data, 'oferta', 'Float64') > {p1:Float64}",
        "ORDER BY JSONExtract(data, 'oferta', 'Float64') DESC",
        "LIMIT 200 OFFSET 40",
      ].join("\n"),
    )
    expect(params).toEqual({ datasetId: DS, p1: 100 })
  })

  it("derives the extraction type from the filter value when no schema is given", () => {
    const { sql, params } = buildRowsSql({
      database: DB,
      datasetId: DS,
      where: { proveedor: "acme", oferta: { op: "lte", value: 99.5 }, activo: true },
    })
    expect(sql).toContain("JSONExtractString(data, 'proveedor') = {p1:String}")
    expect(sql).toContain("JSONExtract(data, 'oferta', 'Float64') <= {p2:Float64}")
    expect(sql).toContain("JSONExtractBool(data, 'activo') = {p3:Bool}")
    expect(params).toEqual({ datasetId: DS, p1: "acme", p2: 99.5, p3: true })
  })

  it("supports in / like operators", () => {
    const { sql, params } = buildRowsSql({
      database: DB,
      datasetId: DS,
      where: {
        status: { op: "in", value: ["open", "won"] },
        name: { op: "like", value: "%acme%" },
      },
    })
    expect(sql).toContain("JSONExtractString(data, 'status') IN {p1:Array(String)}")
    expect(sql).toContain("JSONExtractString(data, 'name') LIKE {p2:String}")
    expect(params).toEqual({ datasetId: DS, p1: ["open", "won"], p2: "%acme%" })
  })

  it("supports multi-column sort and flattened dot columns", () => {
    const { sql } = buildRowsSql({
      database: DB,
      datasetId: DS,
      select: ["n.name"],
      sort: [{ column: "n.name" }, { column: "total", direction: "desc" }],
      schema: [{ name: "total", type: "number" }],
    })
    expect(sql).toContain("JSONExtractRaw(data, 'n.name') AS `n.name`")
    expect(sql).toContain(
      "ORDER BY JSONExtractString(data, 'n.name') ASC, JSONExtract(data, 'total', 'Float64') DESC",
    )
  })
})

describe("buildRowsCountSql", () => {
  it("counts with the same where pushdown", () => {
    const { sql, params } = buildRowsCountSql({
      database: DB,
      datasetId: DS,
      where: { proveedor: "acme" },
    })
    expect(sql).toBe(
      [
        "SELECT count() AS row_count",
        "FROM default.advanced_dataset_rows",
        "WHERE dataset_id = {datasetId:String} AND JSONExtractString(data, 'proveedor') = {p1:String}",
      ].join("\n"),
    )
    expect(params).toEqual({ datasetId: DS, p1: "acme" })
  })
})

describe("buildAggregateSql", () => {
  it("builds sum with groupBy", () => {
    const { sql, params } = buildAggregateSql({
      database: DB,
      datasetId: DS,
      groupBy: "proveedor",
      metric: "sum(oferta)",
    })
    expect(sql).toBe(
      [
        "SELECT JSONExtractString(data, 'proveedor') AS group_key, sum(JSONExtract(data, 'oferta', 'Float64')) AS value",
        "FROM default.advanced_dataset_rows",
        "WHERE dataset_id = {datasetId:String}",
        "GROUP BY group_key",
        "ORDER BY value DESC",
      ].join("\n"),
    )
    expect(params).toEqual({ datasetId: DS })
  })

  it("builds count() without groupBy", () => {
    const { sql } = buildAggregateSql({ database: DB, datasetId: DS, metric: "count()" })
    expect(sql).toBe(
      [
        "SELECT count() AS value",
        "FROM default.advanced_dataset_rows",
        "WHERE dataset_id = {datasetId:String}",
      ].join("\n"),
    )
  })

  it("builds avg with where pushdown", () => {
    const { sql, params } = buildAggregateSql({
      database: DB,
      datasetId: DS,
      metric: "avg(oferta)",
      where: { status: "open" },
    })
    expect(sql).toContain("avg(JSONExtract(data, 'oferta', 'Float64')) AS value")
    expect(sql).toContain("AND JSONExtractString(data, 'status') = {p1:String}")
    expect(params).toEqual({ datasetId: DS, p1: "open" })
  })

  it("min/max respect a string schema type", () => {
    const { sql } = buildAggregateSql({
      database: DB,
      datasetId: DS,
      metric: "max(name)",
      schema: [{ name: "name", type: "string" }],
    })
    expect(sql).toContain("max(JSONExtractString(data, 'name')) AS value")
  })
})

describe("buildEventsSelectSql", () => {
  it("scopes by app/env, filters physical columns, parses datetime bounds", () => {
    const { sql, params } = buildEventsSelectSql({
      database: DB,
      app: "esolbay",
      env: "prod",
      where: {
        namespace: "bids",
        event_at: { op: "gte", value: "2026-01-01T00:00:00Z" },
      },
      limit: 500,
    })
    expect(sql).toBe(
      [
        "SELECT app, env, namespace, action, entity_id, before, after, idempotency_key, toString(event_at) AS event_at, toString(received_at) AS received_at",
        "FROM default.ekairos_events",
        "WHERE app = {app:String} AND env = {env:String} AND namespace = {p0:String} AND event_at >= parseDateTimeBestEffort({p1:String})",
        "ORDER BY event_at ASC",
        "LIMIT 500",
      ].join("\n"),
    )
    expect(params).toEqual({
      app: "esolbay",
      env: "prod",
      p0: "bids",
      p1: "2026-01-01T00:00:00Z",
    })
  })

  it("rejects unknown event columns", () => {
    expect(() =>
      buildEventsSelectSql({ database: DB, app: "a", env: "e", where: { evil: "x" } }),
    ).toThrow(/advanced_dataset_unknown_events_column/)
  })
})

describe("parseMetric", () => {
  it("parses the metric allowlist", () => {
    expect(parseMetric("count()")).toEqual({ fn: "count" })
    expect(parseMetric("sum(oferta)")).toEqual({ fn: "sum", column: "oferta" })
    expect(parseMetric("avg( oferta )")).toEqual({ fn: "avg", column: "oferta" })
    expect(parseMetric("min(a)")).toEqual({ fn: "min", column: "a" })
    expect(parseMetric("max(a)")).toEqual({ fn: "max", column: "a" })
  })

  it("rejects everything outside the allowlist", () => {
    for (const metric of [
      "sum(oferta); DROP TABLE users",
      "sum(oferta) --",
      "toString(x)",
      "sum()",
      "count(x)",
      "sum(a,b)",
      "sum(a') OR 1=1",
      "",
    ]) {
      expect(() => parseMetric(metric), metric).toThrow(/advanced_dataset_invalid_metric/)
    }
  })
})

describe("injection guards", () => {
  it("rejects unsafe column names in select / where / sort / groupBy", () => {
    expect(() =>
      buildRowsSql({ database: DB, datasetId: DS, select: ["oferta; DROP TABLE x"] }),
    ).toThrow(/advanced_dataset_unsafe_column/)
    expect(() =>
      buildRowsSql({ database: DB, datasetId: DS, where: { "a' OR '1'='1": 1 } }),
    ).toThrow(/advanced_dataset_unsafe_column/)
    expect(() => buildRowsSql({ database: DB, datasetId: DS, sort: "col'name:asc" })).toThrow(
      /advanced_dataset_unsafe_column/,
    )
    expect(() =>
      buildAggregateSql({ database: DB, datasetId: DS, metric: "count()", groupBy: "g`roup" }),
    ).toThrow(/advanced_dataset_unsafe_column/)
  })

  it("rejects unsafe sort directions, dataset ids, databases, limits", () => {
    expect(() => buildRowsSql({ database: DB, datasetId: DS, sort: "col:desc; --" })).toThrow(
      /advanced_dataset_invalid_sort_direction/,
    )
    expect(() => buildRowsSql({ database: DB, datasetId: "ds' OR 1=1" })).toThrow(
      /advanced_dataset_unsafe_dataset_id/,
    )
    expect(() => buildRowsSql({ database: "def; DROP", datasetId: DS })).toThrow(
      /advanced_dataset_unsafe_identifier/,
    )
    expect(() => buildRowsSql({ database: DB, datasetId: DS, limit: 1.5 })).toThrow(
      /advanced_dataset_invalid_limit/,
    )
    expect(() => buildRowsSql({ database: DB, datasetId: DS, offset: -1 })).toThrow(
      /advanced_dataset_invalid_offset/,
    )
  })

  it("rejects invalid operators and empty IN lists", () => {
    expect(() =>
      buildRowsSql({
        database: DB,
        datasetId: DS,
        where: { a: { op: "regex" as never, value: "x" } },
      }),
    ).toThrow(/advanced_dataset_invalid_operator/)
    expect(() =>
      buildRowsSql({ database: DB, datasetId: DS, where: { a: { op: "in", value: [] } } }),
    ).toThrow(/advanced_dataset_invalid_in_value/)
  })
})

describe("parseSort", () => {
  it("parses string and array forms", () => {
    expect(parseSort("oferta:desc")).toEqual([{ column: "oferta", direction: "desc" }])
    expect(parseSort("oferta")).toEqual([{ column: "oferta", direction: "asc" }])
    expect(parseSort([{ column: "a" }, { column: "b", direction: "desc" }])).toEqual([
      { column: "a", direction: "asc" },
      { column: "b", direction: "desc" },
    ])
    expect(parseSort(undefined)).toEqual([])
  })
})

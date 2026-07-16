/* @vitest-environment node */

import { defineAction } from "@ekairos/domain"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { dataset } from "../index.js"

const BidItem = z.object({
  code: z.string(),
  description: z.string(),
  quantity: z.number().positive(),
})

describe("dataset(type)", () => {
  it("parses a durable reference and removes observational handle fields", () => {
    const BidItems = dataset(BidItem)

    expect(BidItems.parse({
      datasetId: "dataset_bid_items",
      mode: "built",
      count: 1,
      preview: [{ code: "A-1", description: "Bolt", quantity: 2 }],
    })).toEqual({ datasetId: "dataset_bid_items" })

    expect(() => BidItems.parse({ datasetId: "" })).toThrow()
    expect(() => BidItems.parse({})).toThrow()
  })

  it("serializes the item contract when used as the complete action input", () => {
    const importItems = defineAction({
      input: dataset(BidItem),
      output: z.object({ imported: z.number().int() }),
      execute: async () => ({ imported: 0 }),
    })

    expect(importItems.inputSchema).toMatchObject({
      type: "object",
      properties: {
        datasetId: { type: "string", minLength: 1 },
      },
      required: ["datasetId"],
      additionalProperties: false,
      "x-ekairos-dataset": {
        itemSchema: {
          type: "object",
          properties: {
            code: { type: "string" },
            description: { type: "string" },
            quantity: { type: "number", exclusiveMinimum: 0 },
          },
          required: ["code", "description", "quantity"],
          additionalProperties: false,
        },
      },
    })
  })

  it("composes as a typed attribute of an action input", () => {
    const addItems = defineAction({
      input: z.object({
        bidId: z.string(),
        items: dataset(BidItem),
      }),
      output: z.object({ added: z.number().int() }),
      execute: async ({ input }) => ({
        added: input.items.datasetId === "dataset_bid_items" ? 1 : 0,
      }),
    })

    expect(addItems.input.parse({
      bidId: "bid_1",
      items: { datasetId: "dataset_bid_items" },
    })).toEqual({
      bidId: "bid_1",
      items: { datasetId: "dataset_bid_items" },
    })
    expect(addItems.inputSchema).toMatchObject({
      properties: {
        items: {
          "x-ekairos-dataset": {
            itemSchema: {
              properties: {
                code: { type: "string" },
                quantity: { type: "number" },
              },
            },
          },
        },
      },
    })
  })
})

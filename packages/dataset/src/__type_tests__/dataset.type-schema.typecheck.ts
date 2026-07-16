import { defineAction } from "@ekairos/domain"
import { z } from "zod"

import { dataset, type Dataset } from "../index"

const BidItem = z.object({
  code: z.string(),
  quantity: z.number(),
})
const Supplier = z.object({
  supplierId: z.string(),
  name: z.string(),
})

type BidItemRow = z.output<typeof BidItem>
type SupplierRow = z.output<typeof Supplier>

const importItems = defineAction({
  input: dataset(BidItem),
  output: z.object({ datasetId: z.string() }),
  execute: async ({ input }) => {
    const typed: Dataset<BidItemRow> = input
    return { datasetId: typed.datasetId }
  },
})

const addItems = defineAction({
  input: z.object({
    bidId: z.string(),
    items: dataset(BidItem),
  }),
  output: z.object({ datasetId: z.string() }),
  execute: async ({ input }) => {
    const typed: Dataset<BidItemRow> = input.items
    return { datasetId: typed.datasetId }
  },
})

importItems.input.parse({ datasetId: "dataset_items" })
addItems.input.parse({
  bidId: "bid_1",
  items: { datasetId: "dataset_items" },
})

declare const bidItems: Dataset<BidItemRow>
declare const suppliers: Dataset<SupplierRow>
const sameType: Dataset<BidItemRow> = bidItems
// @ts-expect-error datasets with incompatible item contracts are not interchangeable
const wrongType: Dataset<BidItemRow> = suppliers

void sameType
void wrongType

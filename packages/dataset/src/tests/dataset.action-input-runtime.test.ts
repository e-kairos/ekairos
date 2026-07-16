/* @vitest-environment node */

import { defineAction, domain } from "@ekairos/domain"
import { executeDomainAction } from "@ekairos/domain/internal"
import { EkairosRuntime } from "@ekairos/domain/runtime"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { dataset, datasetDomain } from "../index.js"

const BidItem = z.object({
  code: z.string(),
  quantity: z.number().positive(),
})

type StoredDataset = Readonly<{
  id: string
  datasetId: string
  status?: string
  schema?: unknown
}>

class DatasetActionRuntime extends EkairosRuntime<
  Record<string, never>,
  any,
  any
> {
  constructor(
    private readonly rootDomain: any,
    private readonly rows: ReadonlyMap<string, StoredDataset>,
  ) {
    super({})
  }

  protected getDomain() {
    return this.rootDomain
  }

  protected resolveDb() {
    return {
      query: vi.fn(async (query: any) => {
        const datasetId = query?.dataset_datasets?.$?.where?.datasetId
        const row = this.rows.get(String(datasetId ?? ""))
        return { dataset_datasets: row ? [row] : [] }
      }),
    }
  }
}

function createConsumer(onExecute: () => void) {
  return domain("dataset-consumer")
    .includes(datasetDomain)
    .withSchema({ entities: {}, links: {}, rooms: {} })
    .withActions({
      consumeItems: defineAction({
        input: z.object({
          batches: z.array(z.object({
            items: dataset(BidItem),
          })),
        }),
        output: z.object({ datasetIds: z.array(z.string()) }),
        execute: async ({ input }) => {
          onExecute()
          return {
            datasetIds: input.batches.map((batch) => batch.items.datasetId),
          }
        },
      }),
    })
}

function matchingStoredSchema() {
  return {
    title: "Stored bid items",
    description: "Annotations do not change the row contract.",
    schema: {
      required: ["quantity", "code"],
      properties: {
        quantity: {
          description: "Requested quantity",
          exclusiveMinimum: 0,
          type: "number",
        },
        code: {
          title: "Item code",
          type: "string",
        },
      },
      additionalProperties: false,
      type: "object",
    },
  }
}

function storedDataset(
  datasetId: string,
  overrides: Partial<StoredDataset> = {},
): StoredDataset {
  return {
    id: `entity_${datasetId}`,
    datasetId,
    status: "completed",
    schema: matchingStoredSchema(),
    ...overrides,
  }
}

describe("dataset(type) action input resolution", () => {
  it("validates every nested dataset before executing the action", async () => {
    const execute = vi.fn()
    const consumer = createConsumer(execute)
    const runtime = new DatasetActionRuntime(
      consumer,
      new Map([
        ["dataset_one", storedDataset("dataset_one")],
        ["dataset_two", storedDataset("dataset_two")],
      ]),
    )

    const result = await executeDomainAction(
      runtime,
      consumer.actions.consumeItems,
      {
        batches: [
          { items: { datasetId: "dataset_one" } },
          { items: { datasetId: "dataset_two" } },
        ],
      },
    )

    expect(result.output).toEqual({
      datasetIds: ["dataset_one", "dataset_two"],
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it.each([
    {
      name: "does not exist",
      datasetId: "missing",
      row: undefined,
      error:
        "dataset_action_input_not_found:dataset-consumer.consumeItems:$.batches[0].items:missing",
    },
    {
      name: "is not completed",
      datasetId: "building",
      row: storedDataset("building", { status: "building" }),
      error:
        "dataset_action_input_not_completed:dataset-consumer.consumeItems:$.batches[0].items:building:building",
    },
    {
      name: "has no persisted schema",
      datasetId: "without_schema",
      row: storedDataset("without_schema", { schema: undefined }),
      error:
        "dataset_action_input_schema_missing:dataset-consumer.consumeItems:$.batches[0].items:without_schema",
    },
    {
      name: "has an incompatible schema",
      datasetId: "wrong_schema",
      row: storedDataset("wrong_schema", {
        schema: {
          schema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          },
        },
      }),
      error:
        "dataset_action_input_schema_mismatch:dataset-consumer.consumeItems:$.batches[0].items:wrong_schema",
    },
  ])("rejects a dataset that $name", async ({ datasetId, row, error }) => {
    const execute = vi.fn()
    const consumer = createConsumer(execute)
    const runtime = new DatasetActionRuntime(
      consumer,
      new Map(row ? [[datasetId, row]] : []),
    )

    await expect(
      executeDomainAction(runtime, consumer.actions.consumeItems, {
        batches: [{ items: { datasetId } }],
      }),
    ).rejects.toThrow(error)
    expect(execute).not.toHaveBeenCalled()
  })
})

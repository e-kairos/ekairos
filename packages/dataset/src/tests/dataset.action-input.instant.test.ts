/* @vitest-environment node */

import { config as dotenvConfig } from "dotenv"
import path from "node:path"

import { id as newId, init } from "@instantdb/admin"
import { defineAction, domain } from "@ekairos/domain"
import { executeDomainAction } from "@ekairos/domain/internal"
import { EkairosRuntime } from "@ekairos/domain/runtime"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { dataset, datasetDomain } from "../index.js"
import { hasInstantAdmin, setupInstantTestEnv } from "./_env.js"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

const BidItem = z.object({
  code: z.string(),
  quantity: z.number().positive(),
})

const appDomain = domain("dataset-action-input-instant")
  .includes(datasetDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withActions({
    consumeItems: defineAction({
      input: z.object({ items: dataset(BidItem) }),
      output: z.object({ datasetId: z.string() }),
      execute: async ({ input }) => ({ datasetId: input.items.datasetId }),
    }),
  })

await setupInstantTestEnv(
  "dataset-action-input-instant",
  appDomain.instantSchema(),
  { preferExistingApp: false },
)

const adminDb = hasInstantAdmin()
  ? init({
      appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
      adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
      schema: appDomain.instantSchema(),
    } as any)
  : null

class DatasetActionInstantRuntime extends EkairosRuntime<
  Record<string, never>,
  typeof appDomain,
  any
> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return adminDb as any
  }
}

describe("dataset(type) Instant action input", () => {
  it("resolves a completed persisted dataset before executing", async () => {
    const datasetId = `dataset_action_input_${Date.now()}`
    const { $schema: _dialect, ...itemSchema } = z.toJSONSchema(BidItem, {
      target: "draft-7",
    })

    await adminDb!.transact([
      adminDb!.tx.dataset_datasets[newId()].update({
        datasetId,
        status: "completed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        schema: {
          title: "Persisted bid items",
          schema: itemSchema,
        },
      }),
    ])

    const runtime = new DatasetActionInstantRuntime({})
    const result = await executeDomainAction(
      runtime,
      appDomain.actions.consumeItems,
      { items: { datasetId: `  ${datasetId}  ` } },
    )

    expect(result.output).toEqual({ datasetId })
    expect(result.effectiveInput).toEqual({ items: { datasetId } })
  })
})

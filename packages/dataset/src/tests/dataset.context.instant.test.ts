import { config as dotenvConfig } from "dotenv"
import path from "path"
import { init, id as newId } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"
import { describe, expect, it } from "vitest"

import { dataset } from "../dataset"
import { datasetDomain } from "../schema"
import { hasInstantAdmin, setupInstantTestEnv } from "./_env"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

const sampleDomain = domain("dataset-context-sample").schema({
  entities: {
    sample_items: i.entity({
      name: i.string(),
      category: i.string().indexed(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-context-tests")
  .includes(datasetDomain)
  .includes(sampleDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

await setupInstantTestEnv("dataset-context-tests", appDomain.toInstantSchema(), {
  preferExistingApp: false,
})

const adminDb =
  hasInstantAdmin()
    ? init({
        appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
        adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
        schema: appDomain.toInstantSchema(),
        useDateObjects: true,
      } as any)
    : null

type TestEnv = Record<string, unknown> & {
  orgId: string
}

class DatasetContextTestRuntime extends EkairosRuntime<TestEnv, typeof appDomain, any> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return adminDb as any
  }
}

const testRuntime = new DatasetContextTestRuntime({ orgId: "test-org" })

async function seedRows(category: string) {
  await adminDb!.transact([
    adminDb!.tx.sample_items[newId()].update({
      name: "Notebook",
      category,
    }),
    adminDb!.tx.sample_items[newId()].update({
      name: "Monitor",
      category,
    }),
  ])
}

describe("dataset resource context", () => {
  it("creates a new event context for shortcut materialization and links the dataset to it", async () => {
    const category = `context-${Date.now()}`
    await seedRows(category)

    const result = await dataset(testRuntime)
      .fromQuery(sampleDomain, {
        query: {
          sample_items: {
            $: {
              where: { category },
              fields: ["name", "category"],
              limit: 10,
            },
          },
        },
        title: "context-query",
        explanation: "Query resource for dataset context test.",
      })
      .build({ datasetId: "dataset_context_query_v1" })

    expect(result.previewRows).toHaveLength(2)

    const snapshot = await adminDb!.query({
      dataset_datasets: {
        $: { where: { datasetId: result.datasetId }, limit: 1 },
        context: {},
      } as any,
    })
    const row = snapshot.dataset_datasets?.[0]
    expect(row?.resourceKinds).toBeUndefined()
    expect(row?.context?.id).toBeTruthy()
    expect(row?.context?.resources).toHaveLength(1)
    expect(row?.context?.resources?.[0]?.type).toBe("query")
    expect(row?.context?.resources?.[0]?.query).toBeTruthy()
  })

  it("keeps fromContext exclusive", async () => {
    await expect(
      dataset(testRuntime)
        .fromContext({ id: newId() })
        .fromText({ name: "inline.txt", text: "inline material" })
        .build({ datasetId: "dataset_context_exclusive_v1" }),
    ).rejects.toThrow("dataset_context_resource_is_exclusive")
  })
})

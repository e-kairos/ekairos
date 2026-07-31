/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init, id as newId } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { defineEvent, domain } from "@ekairos/domain"
import { EkairosRuntime } from "../../../domain/src/runtime-handle.ts"
import { configureRuntime } from "@ekairos/domain/runtime"
import { contextDomain } from "@ekairos/events"
import { SandboxService } from "@ekairos/sandbox/service"
import { codexEngine } from "@ekairos/openai-reactor"
import { createTestApp } from "../../../ekairos-test/src/provision.ts"
import { z } from "zod"
import { config as dotenvConfig } from "dotenv"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { DatasetService } from "../service"
import { datasetDomain } from "../domain"
import { Context } from "../../../context/src/index.ts"
import { sandboxDomain } from "../../../sandbox/src/actions.ts"

dotenvConfig({ path: "C:/ek/.env.local", quiet: true })

const TEST_TIMEOUT_MS = 20 * 60 * 1000

const salesDomain = domain("sales").schema({
  entities: {
    sales_orders: i.entity({
      orderId: i.string().indexed(),
      regionId: i.string().indexed(),
      week: i.string().indexed(),
      amount: i.number(),
      status: i.string().indexed(),
    }),
    sales_regions: i.entity({
      regionId: i.string().indexed(),
      name: i.string(),
      country: i.string(),
    }),
  },
  links: {},
  rooms: {},
})

const pipelineRequested = defineEvent({
  payload: z.object({
    pipelineId: z.string(),
    rows: z.array(z.object({
      orderId: z.string(),
      regionId: z.string(),
      region: z.string(),
      week: z.string(),
      amount: z.number(),
      status: z.string(),
    })),
  }),
})

const pipelineCompleted = defineEvent({
  payload: z.object({
    datasetId: z.string(),
    rowCount: z.number().int(),
  }),
})

const appDomain = domain("dataset-semantic-pipeline")
  .includes(contextDomain)
  .includes(sandboxDomain)
  .includes(datasetDomain)
  .includes(salesDomain)
  .schema({ entities: {}, links: {}, rooms: {} })
  .withEvents({ pipelineRequested, pipelineCompleted })
  .withActions({
    ...sandboxDomain.actions,
    ...datasetDomain.actions,
  })
const semanticPipelineScope = appDomain.scope({
  events: [appDomain.events.pipelineRequested],
  actions: [appDomain.actions.replaceRows],
})

type TestEnv = {
  orgId: string
  actorId: string
  appId: string
  adminToken: string
  authJsonPath: string
  configTomlPath?: string
  runtime?: SemanticPipelineRuntime
}

class SemanticPipelineRuntime extends EkairosRuntime<TestEnv, typeof appDomain, ReturnType<typeof init>> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb(env: TestEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: appDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }
}

function rows(snapshot: any, key: string): any[] {
  return Array.isArray(snapshot?.[key]) ? snapshot[key] : []
}

function getInstantProvisionToken() {
  const raw = String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
  if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim()
  }
  return raw
}

function getCodexAuthPath() {
  const codexHome = String(process.env.CODEX_HOME ?? "").trim() || join(homedir(), ".codex")
  return join(codexHome, "auth.json")
}

function getCodexConfigPath() {
  const codexHome = String(process.env.CODEX_HOME ?? "").trim() || join(homedir(), ".codex")
  const configPath = join(codexHome, "config.toml")
  return existsSync(configPath) ? configPath : undefined
}

function hasRealEnv() {
  return Boolean(
    getInstantProvisionToken() &&
      String(process.env.SANDBOX_VERCEL_PROJECT_ID ?? "").trim() &&
      String(process.env.SANDBOX_VERCEL_TEAM_ID ?? "").trim() &&
      String(process.env.SANDBOX_VERCEL_TOKEN ?? process.env.VERCEL_OIDC_TOKEN ?? "").trim() &&
      existsSync(getCodexAuthPath()),
  )
}

async function readDatasetRowsFromRecords(db: any, datasetId: string): Promise<any[]> {
  const snapshot: any = await db.query({
    dataset_datasets: {
      $: { where: { datasetId } as any, limit: 1 },
      records: {},
    } as any,
  })
  const dataset = rows(snapshot, "dataset_datasets")[0]
  const linkedRecords = Array.isArray(dataset?.records) ? dataset.records : []
  return linkedRecords
    .slice()
    .sort((a: any, b: any) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((record: any) => record.rowContent)
}

function createSemanticPipelineEngine(env: TestEnv) {
  return codexEngine({
    repoPath: "/vercel/sandbox",
    bridgePort: 4520,
    auth: {
      source: "local",
      authJsonPath: env.authJsonPath,
      configTomlPath: env.configTomlPath,
    },
  })
}

const describeReal = hasRealEnv() ? describe : describe.skip

describeReal("dataset semantic pipeline with Codex reactors", () => {
  let appId = ""
  let adminToken = ""
  let runtime: SemanticPipelineRuntime | null = null
  let db: ReturnType<typeof init> | null = null
  let sandboxId = ""

  beforeAll(async () => {
    const app = await createTestApp({
      name: `dataset-semantic-pipeline-${Date.now()}`,
      token: getInstantProvisionToken(),
      schema: appDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    runtime = new SemanticPipelineRuntime({
      orgId: "test-org",
      actorId: "dataset-pipeline-test-user",
      appId,
      adminToken,
      authJsonPath: getCodexAuthPath(),
      configTomlPath: getCodexConfigPath(),
    })
    db = init({
      appId,
      adminToken,
      schema: appDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
    configureRuntime({
      domain: { domain: appDomain },
      runtime: async () => ({ db }),
    })

    const regions = [
      { regionId: "NOA", name: "NOA", country: "AR" },
      { regionId: "NEA", name: "NEA", country: "AR" },
      { regionId: "CABA", name: "CABA", country: "AR" },
    ]
    const orders: any[] = []
    for (let week = 1; week <= 4; week++) {
      for (const region of regions) {
        for (let n = 0; n < 5; n++) {
          orders.push({
            orderId: `O-${week}-${region.regionId}-${n}`,
            week: `S${week}`,
            regionId: region.regionId,
            amount: 10 * week + n + (region.regionId === "CABA" ? 20 : 0),
            status: n === 4 ? "refunded" : "paid",
          })
        }
      }
    }
    await db!.transact([
      ...regions.map((region) => db!.tx.sales_regions[newId()].update(region)),
      ...orders.map((order) => db!.tx.sales_orders[newId()].update(order)),
    ])

    const sandbox = await new SandboxService(db as any).createSandbox({
      provider: "vercel",
      runtime: "node22",
      timeoutMs: 20 * 60 * 1000,
      purpose: "dataset-semantic-pipeline",
      ports: [4520],
      vercel: {
        profile: "ephemeral",
        deleteOnStop: true,
        cwd: "C:/ek",
        scope: "ekairos-dev",
      },
    })
    if (!sandbox.ok) throw new Error((sandbox as { error: string }).error)
    sandboxId = sandbox.data.sandboxId
  }, 8 * 60 * 1000)

  afterAll(async () => {
    if (sandboxId && db) {
      await new SandboxService(db as any).stopSandbox(sandboxId).catch(() => {})
    }
  }, 5 * 60 * 1000)

  it("computes and persists a semantic dataset through a Reaction action", async () => {
    if (!runtime || !db) throw new Error("runtime_not_initialized")
    const service = new DatasetService(db as any)
    const pipelineId = `pipeline-${Date.now()}`
    const datasetId = `${pipelineId}_weekly_sales_by_region`
    const rowJsonSchema = {
      type: "object",
      additionalProperties: false,
      required: ["week", "region", "totalAmount"],
      properties: {
        week: { type: "string" },
        region: { type: "string" },
        totalAmount: { type: "number" },
      },
    } as const
    const created = await service.createDataset({
      id: datasetId,
      title: "Weekly paid sales by region",
      status: "pending",
      schema: {
        title: "WeeklySalesByRegion",
        description: "Paid sales totals grouped by week and region.",
        schema: rowJsonSchema,
      },
      sandboxId,
      organizationId: "test-org",
    })
    if (!created.ok) throw new Error((created as { error: string }).error)

    const source: any = await db.query({ sales_orders: {}, sales_regions: {} })
    const regionById = new Map(
      rows(source, "sales_regions").map((region: any) => [region.regionId, region.name]),
    )
    const sourceRows = rows(source, "sales_orders").map((order: any) => ({
      orderId: order.orderId,
      regionId: order.regionId,
      region: regionById.get(order.regionId) ?? order.regionId,
      week: order.week,
      amount: order.amount,
      status: order.status,
    }))
    const computedSchema = z.object({
      explanation: z.string(),
      latex: z.string(),
      rows: z
        .array(
          z.object({
            week: z.string(),
            region: z.string(),
            totalAmount: z.number(),
          }),
        )
        .length(12),
    })
    const engine = createSemanticPipelineEngine(runtime.env)
    const contextKey = `${pipelineId}:semantic`
    await using session = await Context(runtime as any).session(
      contextKey,
      semanticPipelineScope,
      engine,
      { sandbox: sandboxId },
    )
    const computed = await session.from(
      appDomain.events.pipelineRequested({ pipelineId, rows: sourceRows }),
    ).agent({
      instruction: [
        "Keep only paid orders and group them by week and region.",
        "Sum amount into totalAmount and return exactly one row per week-region pair.",
        "Sort rows by week then region and return exactly these keys: explanation, latex, rows.",
        "The rows array must contain all 12 week-region pairs and no error field.",
        `Source rows: ${JSON.stringify(sourceRows)}`,
      ].join(" "),
      output: computedSchema,
      maxRounds: 4,
      datasets: false,
    })
    const effect = await session.from(computed).action(
      appDomain.actions.replaceRows,
      {
        datasetId,
        sandboxId,
        schema: rowJsonSchema,
        rows: computed.payload.rows,
        summary: "Weekly sales dataset persisted.",
      },
    )
    await session.complete()
    expect(effect.payload.success).toBe(true)

    const finalRows = await readDatasetRowsFromRecords(db, datasetId)
    expect(finalRows).toHaveLength(12)
    expect(computed.payload.rows).toHaveLength(12)
    expect(
      finalRows.reduce((sum, row) => sum + Number(row.totalAmount), 0),
    ).toBe(1592)

    const snapshot: any = await db!.query({
      context_contexts: { $: { limit: 20 } },
      context_sessions: { $: { limit: 20 } },
      context_reactions: { $: { limit: 50, order: { createdAt: "asc" } } },
      context_events: { $: { limit: 50, order: { createdAt: "asc" } } },
      context_eventParts: { $: { limit: 100, order: { createdAt: "asc" } } },
      dataset_datasets: { $: { limit: 20, order: { createdAt: "asc" } } },
    } as any)

    const report = {
      appId,
      pipelineId,
      sandboxId,
      contexts: { semantic: session.context.id },
      finalDatasetId: datasetId,
      finalRows,
      entities: snapshot,
    }
    const reportDir = resolve(process.cwd(), ".ekairos", "reports")
    mkdirSync(reportDir, { recursive: true })
    const reportPath = resolve(reportDir, `dataset-semantic-pipeline-codex-${Date.now()}.json`)
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`[dataset-semantic-pipeline-codex] ${reportPath}`)
  }, TEST_TIMEOUT_MS)
})

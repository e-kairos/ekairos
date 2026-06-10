import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { config as dotenvConfig } from "dotenv"
import path from "path"
import { readFile } from "fs/promises"
import { init, id as newId } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { configureRuntime, EkairosRuntime } from "@ekairos/domain/runtime"
import { createScriptedReactor, eventsDomain } from "@ekairos/events"
import { sandboxDomain, SandboxService } from "@ekairos/sandbox"
import { dataset } from "../dataset"
import { getDatasetOutputPath, getDatasetResourcesDir } from "../datasetFiles"
import { datasetDomain } from "../schema"
import { describeInstant, hasInstantAdmin, setupInstantTestEnv } from "./_env"

dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env.local") })
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") })

const registryVercelCwd = path.resolve(__dirname, "..", "..", "..", "registry")

const sampleDomain = domain("sample").schema({
  entities: {
    sample_items: i.entity({
      name: i.string(),
      price: i.number(),
      category: i.string(),
      currency: i.string().optional(),
    }),
    sample_fx_rates: i.entity({
      currency: i.string(),
      usdRate: i.number(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-builder-tests")
  .includes(datasetDomain)
  .includes(sandboxDomain)
  .includes(eventsDomain)
  .includes(sampleDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

await setupInstantTestEnv("dataset-builder-materialization", appDomain.toInstantSchema(), {
  preferExistingApp: false,
})

const adminDb =
  hasInstantAdmin()
    ? init({
        appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID as string,
        adminToken: process.env.INSTANT_APP_ADMIN_TOKEN as string,
        schema: appDomain.toInstantSchema(),
      } as any)
    : null

if (adminDb) {
  configureRuntime({
    domain: { domain: appDomain },
    runtime: async () => ({ db: adminDb } as any),
  })
}

type TestEnv = Record<string, unknown> & {
  orgId: string
}

class DatasetBuilderTestRuntime extends EkairosRuntime<TestEnv, typeof appDomain, any> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return adminDb as any
  }
}

const testRuntime = new DatasetBuilderTestRuntime({ orgId: "test-org" })

function parseJsonl(text: string): any[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function getDatasetSnapshot(datasetId: string) {
  const query: any = await adminDb!.query({
    dataset_datasets: {
      $: { where: { datasetId } as any, limit: 1 },
      dataFile: {},
      context: {},
      records: {},
    } as any,
  })

  const datasetRow = query.dataset_datasets?.[0]
  expect(datasetRow?.datasetId).toBe(datasetId)
  const linkedFile = Array.isArray(datasetRow?.dataFile) ? datasetRow.dataFile[0] : datasetRow?.dataFile
  const linkedRecords = Array.isArray(datasetRow?.records) ? datasetRow.records : []
  let rows: any[]

  if (linkedRecords.length > 0) {
    rows = linkedRecords
      .slice()
      .sort((a: any, b: any) => Number(a.order ?? 0) - Number(b.order ?? 0))
      .map((record: any) => record.rowContent)
  } else {
    expect(typeof linkedFile?.url).toBe("string")
    const response = await fetch(linkedFile.url)
    expect(response.ok).toBe(true)
    const jsonlText = await response.text()
    rows = parseJsonl(jsonlText).filter((entry) => entry?.type === "row").map((entry) => entry.data)
  }

  return {
    dataset: datasetRow,
    rows,
  }
}

async function seedSampleRows(categorySuffix?: string) {
  const electronicsCategory = `electronics${categorySuffix ? `-${categorySuffix}` : ""}`
  const officeCategory = `office${categorySuffix ? `-${categorySuffix}` : ""}`
  const item1 = newId()
  const item2 = newId()
  const item3 = newId()
  const fx1 = newId()
  const fx2 = newId()

  await adminDb!.transact([
    adminDb!.tx.sample_items[item1].update({
      name: `Widget-${Date.now()}`,
      price: 10,
      category: electronicsCategory,
      currency: "USD",
    }),
    adminDb!.tx.sample_items[item2].update({
      name: `Gadget-${Date.now()}`,
      price: 20,
      category: electronicsCategory,
      currency: "EUR",
    }),
    adminDb!.tx.sample_items[item3].update({
      name: `Paper-${Date.now()}`,
      price: 2,
      category: officeCategory,
      currency: "USD",
    }),
    adminDb!.tx.sample_fx_rates[fx1].update({
      currency: "USD",
      usdRate: 1,
    }),
    adminDb!.tx.sample_fx_rates[fx2].update({
      currency: "EUR",
      usdRate: 1.1,
    }),
  ])
  return { electronicsCategory, officeCategory }
}

async function createTestSandbox() {
  const service = new SandboxService(adminDb as any)
  const created = await service.createSandbox({
    provider: "vercel",
    runtime: "python3.13",
    timeoutMs: 10 * 60 * 1000,
    purpose: "dataset.tests",
    vercel: {
      cwd: registryVercelCwd,
      scope: "ekairos-dev",
      environment: "development",
    },
    env: { orgId: "test-org" },
    domain: appDomain,
    dataset: { enabled: true },
  })
  if (!created.ok) {
    throw new Error(created.error)
  }
  return created.data.sandboxId
}

async function stopTestSandbox(sandboxId?: string) {
  if (!sandboxId) return
  const service = new SandboxService(adminDb as any)
  await service.stopSandbox(sandboxId)
}

function scriptedToolStep(toolName: string, input: Record<string, unknown>, text = `call ${toolName}`) {
  const toolCallId = `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    assistantEvent: {
      content: {
        parts: [
          { type: "text", text },
          {
            type: `tool-${toolName}`,
            toolCallId,
            input,
          },
        ],
      },
    },
    actionRequests: [
      {
        actionRef: toolCallId,
        actionName: toolName,
        input,
      },
    ],
    messagesForModel: [],
  }
}

describeInstant("dataset() builder direct API", () => {
  let suiteSandboxId: string | undefined

  beforeAll(async () => {
    suiteSandboxId = await createTestSandbox()
  }, 120000)

  afterAll(async () => {
    await stopTestSandbox(suiteSandboxId)
    suiteSandboxId = undefined
  }, 120000)

  it("fromQuery(domain, query) creates a dataset snapshot without reactor", async () => {
    const { electronicsCategory } = await seedSampleRows(`snapshot-${Date.now()}`)

    const result = await dataset(testRuntime)
      .fromQuery(sampleDomain, {
        query: {
          sample_items: {
            $: {
              where: { category: electronicsCategory },
              fields: ["name", "price", "currency"],
              limit: 10,
            },
          },
        },
        title: "electronics-snapshot",
        explanation: "snapshot",
      })
      .build({ datasetId: "electronics_snapshot_v1" })

    expect(result.datasetId).toBe("electronics_snapshot_v1")
    const snapshot = await getDatasetSnapshot(result.datasetId)
    expect(snapshot.rows.length).toBe(2)
    expect(snapshot.dataset.analysis?.query).toBeTruthy()
    expect(snapshot.dataset.resourceKinds).toBeUndefined()
    expect(snapshot.dataset.context?.resources?.[0]?.type).toBe("query")
    expect(snapshot.dataset.sandboxId ?? null).toBeNull()
  })

  it("multiple resources + asObject can complete directly without executeCommand", async () => {
    const reactor = createScriptedReactor({
      steps: [
        scriptedToolStep(
          "completeObject",
          {
            data: {
              status: "passed",
              score: 92,
              justification: "The available evidence satisfies the criterion.",
            },
            summary: "technical evaluation object complete",
          },
          "complete object directly",
        ),
      ],
    })

    const result = await dataset(testRuntime)
      .sandbox({ sandboxId: suiteSandboxId! })
      .from({
        kind: "text",
        name: "criterion.json",
        mimeType: "application/json",
        text: JSON.stringify({ title: "Operational safety" }),
      })
      .from({
        kind: "text",
        name: "evidence.json",
        mimeType: "application/json",
        text: JSON.stringify([{ refId: "email:1", excerpt: "Safety plan attached." }]),
      })
      .instructions("Evaluate one award against one criterion.")
      .schema({
        title: "TechnicalEvaluationObject",
        description: "One technical evaluation object",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["passed", "failed", "needs_review"] },
            score: { type: "number", minimum: 0, maximum: 100 },
            justification: { type: "string" },
          },
          required: ["status", "score", "justification"],
        },
      })
      .reactor(reactor)
      .asObject()
      .build({ datasetId: "direct_object_transform_v1" })

    expect(result.object).toEqual({
      status: "passed",
      score: 92,
      justification: "The available evidence satisfies the criterion.",
    })
    const snapshot = await getDatasetSnapshot(result.datasetId)
    expect(snapshot.rows).toHaveLength(1)
  }, 240000)

  it("multiple resources can replace rows directly without executeCommand", async () => {
    const reactor = createScriptedReactor({
      steps: [
        scriptedToolStep(
          "replaceRows",
          {
            rows: [
              { sku: "A1", eligible: true },
              { sku: "A2", eligible: false },
            ],
            summary: "eligibility rows complete",
          },
          "replace rows directly",
        ),
      ],
    })

    const result = await dataset(testRuntime)
      .sandbox({ sandboxId: suiteSandboxId! })
      .from({
        kind: "text",
        name: "items.json",
        mimeType: "application/json",
        text: JSON.stringify([{ sku: "A1" }, { sku: "A2" }]),
      })
      .from({
        kind: "text",
        name: "rules.json",
        mimeType: "application/json",
        text: JSON.stringify({ rule: "A1 eligible only" }),
      })
      .instructions("Classify item eligibility.")
      .schema({
        title: "EligibilityRow",
        description: "One eligibility row",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            sku: { type: "string" },
            eligible: { type: "boolean" },
          },
          required: ["sku", "eligible"],
        },
      })
      .reactor(reactor)
      .build({ datasetId: "direct_rows_transform_v1" })

    const snapshot = await getDatasetSnapshot(result.datasetId)
    expect(snapshot.rows).toEqual([
      { sku: "A1", eligible: true },
      { sku: "A2", eligible: false },
    ])
  }, 240000)

  it("fromQuery(domain, query) with instructions + schema + first() produces a one-row dataset", async () => {
    const { electronicsCategory } = await seedSampleRows(`summary-${Date.now()}`)

      const reactor = createScriptedReactor({
        steps: [
          scriptedToolStep(
            "executeCommand",
            {
              scriptName: "summarize_query_resource",
              pythonCode: [
                "import json",
                `resource_path = ${JSON.stringify(`${getDatasetResourcesDir("query_summary_v1")}/resource_query_summary_v1__query_0.jsonl`)}`,
                `output_path = ${JSON.stringify(getDatasetOutputPath("query_summary_v1"))}`,
                "count = 0",
                "total = 0.0",
                "with open(resource_path, 'r', encoding='utf-8') as f:",
                "  for line in f:",
                "    line = line.strip()",
                "    if not line:",
                "      continue",
                "    payload = json.loads(line)",
                "    if payload.get('type') != 'row':",
                "      continue",
                "    row = payload.get('data') or {}",
                "    total += float(row.get('price') or 0)",
                "    count += 1",
                "with open(output_path, 'w', encoding='utf-8') as out:",
                "  out.write(json.dumps({'type': 'row', 'data': {'itemCount': count, 'totalPrice': total}}) + '\\n')",
                "print('summary ready')",
              ].join("\n"),
            },
            "summarize query dataset",
          ),
          scriptedToolStep("completeDataset", { summary: "query summary complete" }, "complete summary dataset"),
        ],
      })

      const result = await dataset(testRuntime)
        .sandbox({ sandboxId: suiteSandboxId! })
        .fromQuery(sampleDomain, {
          query: {
            sample_items: {
              $: {
                where: { category: electronicsCategory },
                fields: ["name", "price", "currency"],
                limit: 10,
              },
            },
          },
          title: "electronics-snapshot",
          explanation: "snapshot",
        })
        .instructions("Summarize the query into one single row")
        .schema({
          title: "ElectronicsSummary",
          description: "One summary row",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              itemCount: { type: "number" },
              totalPrice: { type: "number" },
            },
            required: ["itemCount", "totalPrice"],
          },
        })
        .reactor(reactor)
        .first()
        .build({ datasetId: "query_summary_v1" })

      expect(result.datasetId).toBe("query_summary_v1")
      expect(result.firstRow).toEqual({ itemCount: 2, totalPrice: 30 })
  })

  it("fromFile(fileId) + reactor + schema produces a dataset from csv", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "sample.csv")
    const csvBuffer = await readFile(csvPath)
    const storagePath = `/tests/dataset/${Date.now()}-file-builder.csv`
    const uploadResult = await adminDb!.storage.uploadFile(storagePath, csvBuffer, {
      contentType: "text/csv",
      contentDisposition: "sample.csv",
    })
    const fileId = uploadResult?.data?.id as string

      const reactor = createScriptedReactor({
        steps: [
          scriptedToolStep(
            "executeCommand",
            {
              scriptName: "parse_csv_rows",
              pythonCode: [
                "import csv, glob, json",
                `resources_dir = ${JSON.stringify(getDatasetResourcesDir("file_products_v1"))}`,
                `output_path = ${JSON.stringify(getDatasetOutputPath("file_products_v1"))}`,
                "csv_path = glob.glob(resources_dir + '/*.csv')[0]",
                "with open(csv_path, 'r', encoding='utf-8') as src, open(output_path, 'w', encoding='utf-8') as out:",
                "  reader = csv.DictReader(src)",
                "  for row in reader:",
                "    payload = {",
                "      'type': 'row',",
                "      'data': {",
                "        'code': row['code'],",
                "        'description': row['description'],",
                "        'price': float(row['price']),",
                "      },",
                "    }",
                "    out.write(json.dumps(payload) + '\\n')",
                "print('parsed csv')",
              ].join("\n"),
            },
          ),
          scriptedToolStep("completeDataset", { summary: "csv parsed" }),
        ],
      })

      const result = await dataset(testRuntime)
        .sandbox({ sandboxId: suiteSandboxId! })
        .fromFile({ fileId, description: "supplier csv" })
        .schema({
          title: "ProductRecord",
          description: "One row per product",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              code: { type: "string" },
              description: { type: "string" },
              price: { type: "number" },
            },
            required: ["code", "description", "price"],
          },
        })
        .reactor(reactor)
        .build({ datasetId: "file_products_v1" })

      const snapshot = await getDatasetSnapshot(result.datasetId)
      expect(snapshot.dataset.sandboxId).toBe(suiteSandboxId)
      expect(snapshot.rows).toEqual([
        { code: "A1", description: "Widget", price: 10.5 },
        { code: "A2", description: "Gadget", price: 20 },
        { code: "A3", description: "Thing", price: 30.25 },
      ])
  }, 240000)

  it("fromText(text) + reactor + inferSchema produces a dataset", async () => {
      const reactor = createScriptedReactor({
      steps: [
        scriptedToolStep("generateSchema", {
          schemaTitle: "CsvTextRecord",
          schemaDescription: "One csv row from raw text",
          schemaJson: JSON.stringify({
            type: "object",
            additionalProperties: false,
            properties: {
              code: { type: "string", description: "Product code" },
              description: { type: "string", description: "Product description" },
              price: { type: "number", description: "Unit price" },
            },
            required: ["code", "description", "price"],
          }),
        }),
        scriptedToolStep(
          "executeCommand",
          {
            scriptName: "parse_text_csv",
            pythonCode: [
              "import csv, glob, json",
              `resources_dir = ${JSON.stringify(getDatasetResourcesDir("text_products_v1"))}`,
              `output_path = ${JSON.stringify(getDatasetOutputPath("text_products_v1"))}`,
              "resource_path = glob.glob(resources_dir + '/*')[0]",
              "with open(resource_path, 'r', encoding='utf-8') as src, open(output_path, 'w', encoding='utf-8') as out:",
              "  reader = csv.DictReader(src)",
              "  for row in reader:",
              "    payload = {'type': 'row', 'data': {'code': row['code'], 'description': row['description'], 'price': float(row['price'])}}",
              "    out.write(json.dumps(payload) + '\\n')",
              "print('text parsed')",
            ].join("\n"),
          },
        ),
        scriptedToolStep("completeDataset", { summary: "text parsed" }),
      ],
    })

      const result = await dataset(testRuntime)
        .sandbox({ sandboxId: suiteSandboxId! })
        .fromText({
          text: "code,description,price\nA1,Widget,10.5\nA2,Gadget,20\nA3,Thing,30.25\n",
          mimeType: "text/csv",
          name: "inline.csv",
          description: "inline csv",
        })
        .reactor(reactor)
        .inferSchema()
        .build({ datasetId: "text_products_v1" })

      const snapshot = await getDatasetSnapshot(result.datasetId)
      expect(snapshot.dataset.sandboxId).toBe(suiteSandboxId)
      expect(snapshot.rows.length).toBe(3)
      expect(snapshot.dataset.schema?.schema?.properties?.code).toBeTruthy()
  }, 240000)

  it("fromDataset(datasetId) + reactor + instructions produces a derived dataset", async () => {
    const { electronicsCategory } = await seedSampleRows(`derived-${Date.now()}`)
    const inputDataset = await dataset(testRuntime)
      .fromQuery(sampleDomain, {
        query: {
          sample_items: {
            $: { where: { category: electronicsCategory }, fields: ["name", "price"], limit: 10 },
          },
        },
      })
      .build({ datasetId: "resource_dataset_v1" })

      const reactor = createScriptedReactor({
        steps: [
          scriptedToolStep(
            "executeCommand",
            {
              scriptName: "derive_dataset",
              pythonCode: [
                "import json",
                `resource_path = ${JSON.stringify(`${getDatasetResourcesDir("derived_dataset_v1")}/resource_${inputDataset.datasetId}.jsonl`)}`,
                `output_path = ${JSON.stringify(getDatasetOutputPath("derived_dataset_v1"))}`,
                "with open(resource_path, 'r', encoding='utf-8') as src, open(output_path, 'w', encoding='utf-8') as out:",
                "  for line in src:",
                "    line = line.strip()",
                "    if not line:",
                "      continue",
                "    payload = json.loads(line)",
                "    row = payload.get('data') or {}",
                "    mapped = {'type': 'row', 'data': {'sku': row['name'], 'priceUsd': float(row['price'])}}",
                "    out.write(json.dumps(mapped) + '\\n')",
                "print('dataset derived')",
              ].join("\n"),
            },
          ),
          scriptedToolStep("completeDataset", { summary: "derived dataset complete" }),
        ],
      })

      const result = await dataset(testRuntime)
        .sandbox({ sandboxId: suiteSandboxId! })
        .fromDataset({ datasetId: inputDataset.datasetId, description: "input electronics" })
        .instructions("Rename fields to sku and priceUsd")
        .schema({
          title: "DerivedProduct",
          description: "Derived row",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              sku: { type: "string" },
              priceUsd: { type: "number" },
            },
            required: ["sku", "priceUsd"],
          },
        })
        .reactor(reactor)
        .build({ datasetId: "derived_dataset_v1" })

      const snapshot = await getDatasetSnapshot(result.datasetId)
      expect(snapshot.dataset.sandboxId).toBe(suiteSandboxId)
      expect(snapshot.rows).toHaveLength(2)
      const normalizedRows = [...snapshot.rows].sort((a, b) => Number(a.priceUsd ?? 0) - Number(b.priceUsd ?? 0))
      expect(normalizedRows).toEqual([
        { sku: expect.any(String), priceUsd: 10 },
        { sku: expect.any(String), priceUsd: 20 },
      ])
  }, 240000)

  it("multiple text resources are materialized lazily when executeCommand runs", async () => {
    const reactor = createScriptedReactor({
      steps: [
        scriptedToolStep(
          "executeCommand",
          {
            scriptName: "combine_text_resources",
            commandDescription:
              "Read materialized context text resources from the resources manifest and combine two JSON documents into dataset rows.",
            pythonCode: [
              "import json, os",
              "manifest_path = os.environ['EKAIROS_CONTEXT_RESOURCES_MANIFEST']",
              "with open(manifest_path, 'r', encoding='utf-8') as src:",
              "  manifest = json.load(src)",
              "def resource_file(prefix):",
              "  for resource in manifest['resources']:",
              "    if resource['key'].startswith(prefix):",
              "      files = resource.get('files') or []",
              "      if files:",
              "        return files[0]['path']",
              "  raise RuntimeError(f'missing resource file for {prefix}')",
              "items_path = resource_file('text:0:')",
              "criteria_path = resource_file('text:1:')",
              `output_path = ${JSON.stringify(getDatasetOutputPath("combined_text_resources_v1"))}`,
              "def read_json(path):",
              "  with open(path, 'r', encoding='utf-8') as src:",
              "    return json.load(src)",
              "items = read_json(items_path)",
              "criterion = read_json(criteria_path)['title']",
              "with open(output_path, 'w', encoding='utf-8') as out:",
              "  for item in items:",
                "    payload = {'type': 'row', 'data': {'sku': item['sku'], 'criterion': criterion}}",
              "    out.write(json.dumps(payload) + '\\n')",
              "print('combined text resources')",
            ].join("\n"),
          },
        ),
        scriptedToolStep("completeDataset", { summary: "combined text resources complete" }),
      ],
    })

    const result = await dataset(testRuntime)
      .sandbox({ sandboxId: suiteSandboxId! })
      .from({
        kind: "text",
        name: "items.json",
        mimeType: "application/json",
        text: JSON.stringify([
          { sku: "A1", price: 10 },
          { sku: "A2", price: 20 },
        ]),
      })
      .from({
        kind: "text",
        name: "criterion.json",
        mimeType: "application/json",
        text: JSON.stringify({ title: "Operational safety" }),
      })
      .instructions("Join items with criterion.")
      .schema({
        title: "CombinedTextResource",
        description: "Combined text input row",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            sku: { type: "string" },
            criterion: { type: "string" },
          },
          required: ["sku", "criterion"],
        },
      })
      .reactor(reactor)
      .build({ datasetId: "combined_text_resources_v1" })

    const snapshot = await getDatasetSnapshot(result.datasetId)
    expect(snapshot.dataset.context?.resources?.map((resource: any) => resource.type)).toEqual([
      "text",
      "text",
    ])
    expect(snapshot.dataset.resourceKinds).toBeUndefined()
    expect(snapshot.rows).toEqual([
      { sku: "A1", criterion: "Operational safety" },
      { sku: "A2", criterion: "Operational safety" },
    ])
  }, 240000)

  it("fromContext is exclusive and cannot be mixed with shortcut resources", async () => {
    await expect(
      dataset(testRuntime)
        .fromContext({ id: newId() })
        .fromText({
          name: "inline.txt",
          text: "inline material",
        })
        .build({ datasetId: "context_exclusive_v1" }),
    ).rejects.toThrow("dataset_context_resource_is_exclusive")
  })

  it("multiple resources with reactor and instructions produce a combined dataset", async () => {
    const { electronicsCategory } = await seedSampleRows(`combined-${Date.now()}`)
    const sourceDataset = await dataset(testRuntime)
      .fromQuery(sampleDomain, {
        query: {
          sample_items: {
            $: { where: { category: electronicsCategory }, fields: ["name", "price", "currency"], limit: 10 },
          },
        },
      })
      .build({ datasetId: "combined_resource_dataset_v1" })

      const reactor = createScriptedReactor({
        steps: [
          scriptedToolStep(
            "executeCommand",
            {
              scriptName: "combine_dataset_query",
              pythonCode: [
                "import json",
                `items_path = ${JSON.stringify(`${getDatasetResourcesDir("combined_target_v1")}/resource_${sourceDataset.datasetId}.jsonl`)}`,
                `rates_path = ${JSON.stringify(`${getDatasetResourcesDir("combined_target_v1")}/resource_combined_target_v1__query_1.jsonl`)}`,
                `output_path = ${JSON.stringify(getDatasetOutputPath("combined_target_v1"))}`,
                "rates = {}",
                "with open(rates_path, 'r', encoding='utf-8') as src:",
                "  for line in src:",
                "    if not line.strip():",
                "      continue",
                "    payload = json.loads(line)",
                "    row = payload.get('data') or {}",
                "    rates[row['currency']] = float(row['usdRate'])",
                "with open(items_path, 'r', encoding='utf-8') as src, open(output_path, 'w', encoding='utf-8') as out:",
                "  for line in src:",
                "    if not line.strip():",
                "      continue",
                "    payload = json.loads(line)",
                "    row = payload.get('data') or {}",
                "    usd_rate = rates.get(row['currency'], 1.0)",
                "    mapped = {'type': 'row', 'data': {'name': row['name'], 'priceUsd': round(float(row['price']) * usd_rate, 2)}}",
                "    out.write(json.dumps(mapped) + '\\n')",
                "print('combined dataset ready')",
              ].join("\n"),
            },
          ),
          scriptedToolStep("completeDataset", { summary: "combined dataset complete" }),
        ],
      })

      const result = await dataset(testRuntime)
        .sandbox({ sandboxId: suiteSandboxId! })
        .fromDataset({ datasetId: sourceDataset.datasetId, description: "electronics" })
        .fromQuery(sampleDomain, {
          query: {
            sample_fx_rates: {
              $: { fields: ["currency", "usdRate"], limit: 10 },
            },
          },
          title: "fx-rates",
          explanation: "currency conversion",
        })
        .instructions("Join prices with fx rates and emit priceUsd")
        .schema({
          title: "CombinedProduct",
          description: "Combined rows",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              priceUsd: { type: "number" },
            },
            required: ["name", "priceUsd"],
          },
        })
        .reactor(reactor)
        .build({ datasetId: "combined_target_v1" })

      const snapshot = await getDatasetSnapshot(result.datasetId)
      expect(snapshot.dataset.sandboxId).toBe(suiteSandboxId)
      expect(snapshot.rows.length).toBe(2)
  }, 240000)

  it("first() fails when the result contains more than one row", async () => {
    const { electronicsCategory } = await seedSampleRows(`first-${Date.now()}`)

    await expect(
      dataset(testRuntime)
        .fromQuery(sampleDomain, {
          query: {
            sample_items: {
              $: { where: { category: electronicsCategory }, fields: ["name", "price"], limit: 10 },
            },
          },
        })
        .first()
        .build({ datasetId: "query_first_fail_v1" }),
    ).rejects.toThrow("dataset_first_expected_zero_or_one_row")
  })

  it("fromFile without sandbox fails with dataset_sandbox_required", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "sample.csv")
    const csvBuffer = await readFile(csvPath)
    const storagePath = `/tests/dataset/${Date.now()}-file-no-reactor.csv`
    const uploadResult = await adminDb!.storage.uploadFile(storagePath, csvBuffer, {
      contentType: "text/csv",
      contentDisposition: "sample.csv",
    })
    const fileId = uploadResult?.data?.id as string

    await expect(
      dataset(testRuntime)
        .fromFile({ fileId })
        .schema({
          title: "ProductRecord",
          description: "Product row",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              code: { type: "string" },
            },
            required: ["code"],
          },
        })
        .build({ datasetId: "file_no_sandbox_v1" }),
    ).rejects.toThrow("dataset_sandbox_required")
  })

  it("fromText without sandbox fails with dataset_sandbox_required", async () => {
    await expect(
      dataset(testRuntime)
        .fromText({ text: "hello", name: "hello.txt" })
        .build({ datasetId: "text_no_sandbox_v1" }),
    ).rejects.toThrow("dataset_sandbox_required")
  })

  it("fromDataset without sandbox fails with dataset_sandbox_required", async () => {
    const { electronicsCategory } = await seedSampleRows(`noreactor-dataset-${Date.now()}`)
    const inputDataset = await dataset(testRuntime)
      .fromQuery(sampleDomain, {
        query: {
          sample_items: {
            $: { where: { category: electronicsCategory }, fields: ["name", "price"], limit: 10 },
          },
        },
      })
      .build({ datasetId: "dataset_resource_no_reactor_v1" })

    await expect(
      dataset(testRuntime)
        .fromDataset({ datasetId: inputDataset.datasetId })
        .build({ datasetId: "dataset_no_sandbox_v1" }),
    ).rejects.toThrow("dataset_sandbox_required")
  })

  it("multiple resources without sandbox fail with dataset_sandbox_required", async () => {
    const { electronicsCategory } = await seedSampleRows(`noreactor-multi-${Date.now()}`)
    const inputDataset = await dataset(testRuntime)
      .fromQuery(sampleDomain, {
        query: {
          sample_items: {
            $: { where: { category: electronicsCategory }, fields: ["name", "price"], limit: 10 },
          },
        },
      })
      .build({ datasetId: "multi_no_reactor_resource_v1" })

    await expect(
      dataset(testRuntime)
        .fromDataset({ datasetId: inputDataset.datasetId })
        .fromQuery(sampleDomain, {
          query: {
            sample_fx_rates: {
              $: { fields: ["currency", "usdRate"], limit: 10 },
            },
          },
        })
        .build({ datasetId: "multi_no_sandbox_v1" }),
    ).rejects.toThrow("dataset_sandbox_required")
  })

  it("fromFile with sandbox but without reactor fails with dataset_reactor_required", async () => {
    const csvPath = path.resolve(__dirname, "fixtures", "sample.csv")
    const csvBuffer = await readFile(csvPath)
    const storagePath = `/tests/dataset/${Date.now()}-file-reactor-missing.csv`
    const uploadResult = await adminDb!.storage.uploadFile(storagePath, csvBuffer, {
      contentType: "text/csv",
      contentDisposition: "sample.csv",
    })
    const fileId = uploadResult?.data?.id as string

    await expect(
      dataset(testRuntime)
        .sandbox({ sandboxId: suiteSandboxId! })
        .fromFile({ fileId })
        .schema({
          title: "ProductRecord",
          description: "Product row",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              code: { type: "string" },
            },
            required: ["code"],
          },
        })
        .build({ datasetId: "file_reactor_missing_v1" }),
    ).rejects.toThrow("dataset_reactor_required")
  })

  it("build({ datasetId }) persists the target id and keeps input ids separate", async () => {
    const { electronicsCategory } = await seedSampleRows(`target-${Date.now()}`)
    const inputDataset = await dataset(testRuntime)
      .fromQuery(sampleDomain, {
        query: {
          sample_items: {
            $: { where: { category: electronicsCategory }, fields: ["name", "price"], limit: 10 },
          },
        },
      })
      .build({ datasetId: "target_resource_snapshot_v1" })

      const reactor = createScriptedReactor({
        steps: [
          scriptedToolStep(
            "executeCommand",
            {
              scriptName: "copy_resource_dataset",
              pythonCode: [
                "import json",
                `resource_path = ${JSON.stringify(`${getDatasetResourcesDir("target_output_v1")}/resource_${inputDataset.datasetId}.jsonl`)}`,
                `output_path = ${JSON.stringify(getDatasetOutputPath("target_output_v1"))}`,
                "with open(resource_path, 'r', encoding='utf-8') as src, open(output_path, 'w', encoding='utf-8') as out:",
                "  out.write(src.read())",
                "print('copied input dataset')",
              ].join("\n"),
            },
          ),
          scriptedToolStep("completeDataset", { summary: "copied dataset" }),
        ],
      })

      const result = await dataset(testRuntime)
        .sandbox({ sandboxId: suiteSandboxId! })
        .fromDataset({ datasetId: inputDataset.datasetId, description: "copy me" })
        .instructions("Copy the dataset as-is")
        .schema({
          title: "CopiedRow",
          description: "Copied row",
          schema: {
            type: "object",
            additionalProperties: true,
            properties: {
              name: { type: "string" },
              price: { type: "number" },
            },
            required: ["name", "price"],
          },
        })
        .reactor(reactor)
        .build({ datasetId: "target_output_v1" })

      expect(result.datasetId).toBe("target_output_v1")
      expect(result.datasetId).not.toBe(inputDataset.datasetId)
      const snapshot = await getDatasetSnapshot(result.datasetId)
      expect(snapshot.dataset.datasetId).toBe("target_output_v1")
      expect(snapshot.dataset.sandboxId).toBe(suiteSandboxId)
  }, 240000)
})

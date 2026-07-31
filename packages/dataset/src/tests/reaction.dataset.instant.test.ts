/* @vitest-environment node */

import { randomUUID } from "node:crypto"

import { init } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { defineEvent, domain, EkairosRuntime } from "@ekairos/domain"
import { contextDomain } from "@ekairos/events"
import { afterAll, beforeAll, expect, it } from "vitest"
import { z } from "zod"

import { Context } from "../../../context/src/index.ts"
import { sandboxDomain } from "../../../sandbox/src/actions.ts"
import {
  describeInstant,
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import { buildReactionDataset } from "../reactionDataset.js"
import { datasetDomain } from "../domain.js"
import { DatasetService } from "../service.js"
import { actionStep, deterministicReactionEngine } from "./_reactionEngine.js"

const liveSandboxExternalId = String(
  process.env.DATASET_TEST_LIVE_SANDBOX_ID ?? "",
).trim()
const liveSandboxProvider = String(
  process.env.DATASET_TEST_LIVE_SANDBOX_PROVIDER ?? "sprites",
).trim()
const itLiveSandbox = liveSandboxExternalId ? itInstant : it.skip

const inboxDomain = domain("datasetInbox")
  .includes(contextDomain)
  .withSchema({
    entities: {
      dataset_inbox_messages: i.entity({ subject: i.string() }),
    },
    links: {},
    rooms: {},
  })
  .withEvents({
    received: defineEvent({
      payload: z.object({ subject: z.string() }),
      links: {
        message: { on: "dataset_inbox_messages", has: "one" },
        files: { on: "$files", has: "many" },
      },
    }),
    answered: defineEvent({
      payload: z.object({ datasetId: z.string(), itemCount: z.number().int() }),
      links: { message: { on: "dataset_inbox_messages", has: "one" } },
    }),
  })

const appDomain = domain("dataset-reaction-test")
  .includes(inboxDomain)
  .includes(sandboxDomain)
  .includes(datasetDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withActions({
    ...sandboxDomain.actions,
    ...datasetDomain.actions,
  })

type TestEnv = { appId: string; adminToken: string }

class DatasetReactionRuntime extends EkairosRuntime<
  TestEnv,
  typeof appDomain,
  ReturnType<typeof init>
> {
  protected getDomain() { return appDomain }

  protected resolveDb(env: TestEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: appDomain.instantSchema(),
      useDateObjects: true,
    } as any)
  }

  readonly materializeDataset = buildReactionDataset
}

describeInstant("Reaction Dataset operation", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>
  const previousLocalSandbox = process.env.DATASET_TEST_LOCAL_SANDBOX

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "reaction-dataset-operation",
      schema: appDomain.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({ ...app, schema: appDomain.instantSchema(), useDateObjects: true } as any)
    process.env.DATASET_TEST_LOCAL_SANDBOX = "1"
  }, 60_000)

  afterAll(async () => {
    if (previousLocalSandbox === undefined) delete process.env.DATASET_TEST_LOCAL_SANDBOX
    else process.env.DATASET_TEST_LOCAL_SANDBOX = previousLocalSandbox
    await destroyContextTestApp(appId)
  }, 60_000)

  itLiveSandbox("materializes a causal Event from a flat Session", async () => {
    const runtime = new DatasetReactionRuntime({ appId, adminToken })
    const sandboxId = randomUUID()
    const messageId = randomUUID()
    await db.transact([
      db.tx.dataset_inbox_messages[messageId].update({ subject: "Quote CSV" }),
      db.tx.sandbox_sandboxes[sandboxId].update({
        provider: liveSandboxProvider,
        externalSandboxId: liveSandboxExternalId,
        status: "active",
        createdAt: Date.now(),
      }),
    ])
    const upload = await db.storage.uploadFile(
      `/reaction-dataset/${randomUUID()}/items.csv`,
      Buffer.from("code,description,price\nA1,Bolt,10.5\nA2,Nut,20.25\n"),
      { contentType: "text/csv", contentDisposition: "items.csv" },
    )
    const fileId = (upload as any).data.id as string
    const context = await Context(runtime).open({
      key: `dataset-reaction:${messageId}`,
      content: { purpose: "quote" },
    })
    const trigger = await context.append(
      inboxDomain.events.received({ subject: "Quote CSV" }).link({
        message: messageId,
        files: [fileId],
      }),
    )

    const pythonCode = [
      "import json",
      "import os",
      "script_dir = os.path.dirname(__file__)",
      "session_dir = os.path.dirname(script_dir)",
      "output_path = os.path.join(session_dir, 'output', 'output.jsonl')",
      "os.makedirs(os.path.dirname(output_path), exist_ok=True)",
      "rows = [",
      "  {'code': 'A1', 'description': 'Bolt', 'price': 10.5},",
      "  {'code': 'A2', 'description': 'Nut', 'price': 20.25},",
      "]",
      "with open(output_path, 'w', encoding='utf-8') as output:",
      "  for row in rows:",
      "    output.write(json.dumps({'type': 'row', 'data': row}) + '\\n')",
      "print(f'wrote_rows={len(rows)} output={output_path}')",
    ].join("\n")
    const engine = deterministicReactionEngine({
      steps: [
        actionStep("executeCommand", {
          commandDescription: "Parse the attached CSV into the declared row schema.",
          pythonCode,
          scriptName: "parse_items",
        }),
        actionStep("completeDataset", {
          summary: "Two item rows materialized from the attached CSV.",
        }),
      ],
    })
    const rowSchema = z.object({
      code: z.string(),
      description: z.string(),
      price: z.number(),
    })
    const session = context.session({
      scope: inboxDomain,
      engine,
      sandbox: sandboxId,
    })
    const answer = await session.from(trigger).dataset({
      instruction: "Extract one canonical item row per CSV row.",
      schema: rowSchema,
    })
    await session.complete()
    expect(answer.payload.count).toBe(2)
    expect(answer.payload.preview).toEqual([
      { code: "A1", description: "Bolt", price: 10.5 },
      { code: "A2", description: "Nut", price: 20.25 },
    ])

    const graph = await db.query({
      context_sessions: {
        $: { where: { context: context.id }, limit: 1 },
        trigger: {},
        rootReaction: { causes: {}, effects: {} },
        reactions: { causes: {}, effects: { eventParts: {} } },
      },
    } as any)
    const parent = (graph as any).context_sessions[0]
    expect(parent.status).toBe("completed")

    const datasetReaction = parent.reactions.find((row: any) => row.type === "dataset")
    expect(datasetReaction.causeIds).toEqual([trigger.id])
    expect(datasetReaction.effects[0].payload).toEqual({
      datasetId: answer.payload.datasetId,
      mode: "built",
      count: 2,
      preview: [
        { code: "A1", description: "Bolt", price: 10.5 },
        { code: "A2", description: "Nut", price: 20.25 },
      ],
    })
    expect(datasetReaction.effects[0].payload).not.toHaveProperty("reader")

  }, 120_000)

  itInstant("lets Agent materialize a scoped InstaQL Dataset", async () => {
    const runtime = new DatasetReactionRuntime({ appId, adminToken })
    const messages = [
      { id: randomUUID(), subject: "Cohort alpha" },
      { id: randomUUID(), subject: "Cohort beta" },
      { id: randomUUID(), subject: "Cohort gamma" },
    ]
    await db.transact(messages.map(message =>
      db.tx.dataset_inbox_messages[message.id].update({ subject: message.subject })))

    const context = await Context(runtime).open({
      key: `dataset-agent-query:${randomUUID()}`,
      content: { purpose: "cohort-query" },
    })
    const trigger = await context.append(
      inboxDomain.events.received({ subject: "Group all inbox messages" }).link({
        message: messages[0]!.id,
      }),
    )
    const engine = deterministicReactionEngine({
      steps: [
        actionStep("dataset.materialize", {
          title: "Inbox cohort",
          explanation: "Read the complete scoped inbox collection once.",
          query: {
            dataset_inbox_messages: {
              $: { fields: ["subject"] },
            },
          },
        }),
      ],
    })
    const session = context.session({
      scope: inboxDomain,
      engine,
      sandbox: false,
    })
    const answer = await session.from(trigger).agent({
      instruction: "Materialize the full collection before answering.",
      output: z.object({
        completed: z.literal(true),
        action: z.literal("dataset.materialize"),
        output: z.object({
          datasetId: z.string(),
          mode: z.enum(["opened", "built"]),
          preview: z.array(z.unknown()),
          count: z.number().optional(),
        }),
      }),
    })
    await session.complete()
    const itemCount = answer.payload.output.count ?? answer.payload.output.preview.length
    expect(itemCount).toBeGreaterThanOrEqual(messages.length)

    const stored = await db.query({
      dataset_datasets: {
        $: { where: { datasetId: answer.payload.output.datasetId } },
        dataFile: {},
      },
      context_sessions: {
        $: { where: { context: context.id } },
        reactions: {
          effects: {
            eventParts: { $: { order: { index: "asc" } } },
          },
        },
      },
    } as any)
    const dataset = (stored as any).dataset_datasets[0]
    expect(dataset.status).toBe("completed")
    expect(dataset.actualGeneratedRowCount).toBe(itemCount)
    expect(dataset.dataFile).toMatchObject({ id: expect.any(String) })

    const read = await new DatasetService(db as any).readRows({
      datasetId: answer.payload.output.datasetId,
      limit: 100,
    })
    if (!read.ok) throw new Error(read.error)
    expect(read.data.rows.map((row: any) => row.subject)).toEqual(
      expect.arrayContaining(messages.map(message => message.subject)),
    )

    const storedSession = (stored as any).context_sessions[0]
    const agent = storedSession.reactions.find((reaction: any) => reaction.type === "agent")
    const actionParts = agent.effects[0].eventParts
      .map((part: any) => part.content)
      .filter((part: any) => part.actionName === "dataset.materialize")
    expect(actionParts.map((part: any) => part.status)).toEqual(["started", "completed"])
    expect(actionParts[1].output.datasetId).toBe(answer.payload.output.datasetId)
  }, 120_000)
})

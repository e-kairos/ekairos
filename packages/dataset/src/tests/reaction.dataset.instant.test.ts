/* @vitest-environment node */

import { randomUUID } from "node:crypto"

import { init } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { defineEvent, domain, EkairosRuntime } from "@ekairos/domain"
import { Events, contextDomain } from "@ekairos/events"
import { defineReaction } from "@ekairos/reactor"
import { sandboxDomain } from "@ekairos/sandbox/schema"
import { afterAll, beforeAll, expect } from "vitest"
import { z } from "zod"

import { Context } from "../../../context/src/index.ts"
import {
  describeInstant,
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import { buildReactionDataset } from "../reactionDataset.js"
import { datasetDomain } from "../schema.js"
import { actionStep, deterministicReactionEngine } from "./_reactionEngine.js"

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
  .withActions(sandboxDomain.actions)
  .withActions(datasetDomain.actions)

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

  async materializeDataset(input: Parameters<typeof buildReactionDataset>[0]) {
    return await buildReactionDataset(input)
  }
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

  itInstant("materializes a causal Event in a linked child Session", async () => {
    const runtime = new DatasetReactionRuntime({ appId, adminToken })
    const sandboxId = randomUUID()
    const messageId = randomUUID()
    await db.transact([
      db.tx.dataset_inbox_messages[messageId].update({ subject: "Quote CSV" }),
      db.tx.sandbox_sandboxes[sandboxId].update({
        provider: "sprites",
        externalSandboxId: sandboxId,
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
    const context = await Context(runtime).create({
      key: `dataset-reaction:${messageId}`,
      content: { purpose: "quote" },
    })
    const trigger = await Events(runtime).emit(
      inboxDomain.events.received({ subject: "Quote CSV" }).link({
        message: messageId,
        files: [fileId],
      }),
      { id: randomUUID(), channel: "email", contextId: context.id },
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
    const definition = defineReaction(
      inboxDomain.events.received,
      {
        key: "dataset-inbox.answer",
        scope: inboxDomain,
        engine,
        sandbox: sandboxId,
      },
      async reaction => {
        const items = await reaction.given(reaction.trigger).dataset({
          instruction: "Extract one canonical item row per CSV row.",
          schema: rowSchema,
        })
        const rows = items.payload.preview
        expect(rows).toEqual([
          { code: "A1", description: "Bolt", price: 10.5 },
          { code: "A2", description: "Nut", price: 20.25 },
        ])
        return await reaction.given(items).emit(
          inboxDomain.events.answered({
            datasetId: items.payload.datasetId,
            itemCount: rows.length,
          }).link({ message: messageId }),
        )
      },
    )

    const answer = await context.react(trigger, definition)
    expect(answer.payload.itemCount).toBe(2)

    const graph = await db.query({
      context_sessions: {
        $: { where: { context: context.id }, limit: 1 },
        trigger: {},
        rootReaction: { causes: {}, effects: {} },
        reactions: { causes: {}, effects: { eventParts: {} } },
        children: {
          context: {},
          trigger: {},
          rootReaction: { causes: {}, effects: {} },
          reactions: { causes: {}, effects: { eventParts: {} } },
        },
      },
    } as any)
    const parent = (graph as any).context_sessions[0]
    expect(parent.status).toBe("completed")
    expect(parent.children).toHaveLength(1)

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

    const child = parent.children[0]
    expect(child.status).toBe("completed")
    const childContext = Array.isArray(child.context) ? child.context[0] : child.context
    const childTrigger = Array.isArray(child.trigger) ? child.trigger[0] : child.trigger
    const childRoot = Array.isArray(child.rootReaction)
      ? child.rootReaction[0]
      : child.rootReaction
    expect(childContext.id).not.toBe(context.id)
    expect(childTrigger).toMatchObject({
      type: "dataset.materializationRequested",
      domain: "dataset",
      name: "materializationRequested",
    })
    expect(childRoot.effects).toEqual([
      expect.objectContaining({
        type: "dataset.materialized",
        payload: {
          datasetId: answer.payload.datasetId,
          status: "materialized",
        },
      }),
    ])
    const childReactions = [...child.reactions]
      .sort((left: any, right: any) => left.position - right.position)
    expect(childReactions.map((row: any) => row.type)).toEqual([
      "dataset.file.materialize:" + answer.payload.datasetId,
      "action",
      "agent",
      "emit",
    ])
    const agent = childReactions.find((row: any) => row.type === "agent")
    const completedActions = agent.effects[0].eventParts
      .map((part: any) => part.content)
      .filter((part: any) => part.status === "completed")
      .map((part: any) => part.actionName)
    expect(completedActions).toEqual(expect.arrayContaining([
      "dataset.executeCommand",
      "dataset.completeDataset",
    ]))
  }, 120_000)
})

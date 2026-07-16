/* @vitest-environment node */

import { randomUUID } from "node:crypto"
import { init } from "@instantdb/admin"
import { ContextHandle, Events } from "@ekairos/events"
import { afterAll, beforeAll, expect } from "vitest"

import {
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import { executeReaction } from "../../../reactor/src/reaction.ts"
import {
  reactionDatasetWorkflow,
  reactionDatasetWorkflowDefinition,
  reactionDatasetWorkflowDomain,
  ReactionDatasetWorkflowRuntime,
} from "./workflow/reaction.dataset.workflow-fixtures.ts"

let appId = ""
let adminToken = ""
let db: ReturnType<typeof init>
const previousLocalSandbox = process.env.DATASET_TEST_LOCAL_SANDBOX

beforeAll(async () => {
  const app = await provisionContextTestApp({
    name: `reaction-dataset-workflow-${Date.now()}`,
    schema: reactionDatasetWorkflowDomain.instantSchema(),
  })
  appId = app.appId
  adminToken = app.adminToken
  db = init({
    appId,
    adminToken,
    schema: reactionDatasetWorkflowDomain.instantSchema(),
    useDateObjects: true,
  } as any)
  process.env.DATASET_TEST_LOCAL_SANDBOX = "1"
}, 60_000)

afterAll(async () => {
  if (previousLocalSandbox === undefined) delete process.env.DATASET_TEST_LOCAL_SANDBOX
  else process.env.DATASET_TEST_LOCAL_SANDBOX = previousLocalSandbox
  await destroyContextTestApp(appId)
}, 60_000)

itInstant("materializes Dataset in a child Session through the Reaction Workflow API", async () => {
  const runtime = new ReactionDatasetWorkflowRuntime({ appId, adminToken })
  const sandboxId = randomUUID()
  await db.transact([
    db.tx.sandbox_sandboxes[sandboxId].update({
      provider: "sprites",
      externalSandboxId: sandboxId,
      status: "active",
      createdAt: Date.now(),
    }),
  ])
  const context = await ContextHandle.create(runtime, {
    key: `reaction-dataset-workflow:${randomUUID()}`,
    content: { sandboxId },
  })
  const trigger = await Events(runtime).emit(
    reactionDatasetWorkflowDomain.events.received([
      { code: "A1", description: "Bolt", price: 10.5 },
      { code: "A2", description: "Nut", price: 20.25 },
    ]),
    {
      id: randomUUID(),
      contextId: context.id,
      channel: "test",
      createdAt: new Date(),
    },
  )

  const effect = await executeReaction(
    runtime,
    context,
    trigger,
    reactionDatasetWorkflowDefinition,
    { workflow: reactionDatasetWorkflow },
  )

  expect(effect.payload.itemCount).toBe(2)
  expect(effect.payload.datasetId).toBeTruthy()

  const result = await db.query({
    context_contexts: {
      $: { where: { id: context.id }, limit: 1 },
      sessions: {
        rootReaction: { effects: {} },
        reactions: { causes: {}, effects: {} },
        children: {
          trigger: {},
          rootReaction: { effects: {} },
          reactions: { causes: {}, effects: { eventParts: {} } },
        },
      },
    },
  } as any)
  const parent = (result as any).context_contexts[0].sessions[0]
  expect(parent.status).toBe("completed")
  expect(parent.workflowRunId).toBeTruthy()
  expect(parent.children).toHaveLength(1)

  const datasetReaction = parent.reactions.find((row: any) => row.type === "dataset")
  expect(datasetReaction.causes.map((event: any) => event.id)).toEqual([trigger.id])
  expect(datasetReaction.effects[0].payload).toMatchObject({
    datasetId: effect.payload.datasetId,
    mode: "built",
    count: 2,
  })

  const child = parent.children[0]
  expect(child.status).toBe("completed")
  expect(child.trigger).toEqual(expect.objectContaining({
    type: "dataset.materializationRequested",
    domain: "dataset",
    name: "materializationRequested",
  }))
  const childTypes = [...child.reactions]
    .sort((left: any, right: any) => left.position - right.position)
    .map((row: any) => row.type)
  expect(childTypes).toEqual([
    `dataset.file.materialize:${effect.payload.datasetId}`,
    "action",
    "agent",
    "emit",
  ])
}, 180_000)

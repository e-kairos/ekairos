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
import { executeReaction } from "../reaction.ts"
import {
  reactorWorkflow,
  reactorWorkflowDomain,
  reactorWorkflowReaction,
  ReactorWorkflowRuntime,
} from "./workflow/reaction.workflow-fixtures.ts"

let appId = ""
let adminToken = ""
let db: ReturnType<typeof init>

beforeAll(async () => {
  const app = await provisionContextTestApp({
    name: `reactor-workflow-${Date.now()}`,
    schema: reactorWorkflowDomain.instantSchema(),
  })
  appId = app.appId
  adminToken = app.adminToken
  db = init({
    appId,
    adminToken,
    schema: reactorWorkflowDomain.instantSchema(),
    useDateObjects: true,
  } as any)
}, 60_000)

afterAll(async () => {
  await destroyContextTestApp(appId)
}, 60_000)

itInstant("runs the new Reaction API through Workflow and persists its causal graph", async () => {
  const runtime = new ReactorWorkflowRuntime({ appId, adminToken })
  const context = await ContextHandle.create(runtime, {
    key: `reactor-workflow:${randomUUID()}`,
    content: { prefix: "workflow" },
  })
  const trigger = await Events(runtime).emit(
    reactorWorkflowDomain.events.requested({ message: "hello" }),
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
    reactorWorkflowReaction,
    { workflow: reactorWorkflow },
  )

  expect(effect.payload).toEqual({ message: "workflow:hello" })

  const result = await db.query({
    context_contexts: {
      $: { where: { id: context.id }, limit: 1 },
      sessions: {
        trigger: {},
        rootReaction: { effects: {} },
        reactions: {
          causes: {},
          effects: {
            eventParts: { $: { order: { index: "asc" } } },
          },
        },
      },
    },
  } as any)
  const session = (result as any).context_contexts[0].sessions[0]
  const rootReaction = Array.isArray(session.rootReaction)
    ? session.rootReaction[0]
    : session.rootReaction

  expect(session.status).toBe("completed")
  expect(session.workflowRunId).toBeTruthy()
  expect(rootReaction.effects.map((event: any) => event.id)).toContain(effect.id)
  expect(session.reactions
    .sort((left: any, right: any) => left.position - right.position)
    .map((reaction: any) => reaction.type))
    .toEqual(["reactor.workflow.integration", "agent", "emit"])

  const agent = session.reactions.find((reaction: any) => reaction.type === "agent")
  expect(agent.causes.map((event: any) => event.id)).toEqual([trigger.id])
  expect(agent.effects[0].eventParts.map((part: any) => part.content.text))
    .toEqual(["workflow:hello"])
}, 120_000)

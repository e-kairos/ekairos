/* @vitest-environment node */

import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { init } from "@instantdb/admin"
import { ContextHandle, Events } from "@ekairos/events"
import { afterAll, beforeAll, expect } from "vitest"
import { start } from "workflow/api"

import {
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import {
  reactorWorkflow,
  ReactorWorkflowContext,
  reactorWorkflowDomain,
  ReactorWorkflowRuntime,
} from "./workflow/reaction.workflow-fixtures.ts"

let appId = ""
let adminToken = ""
let db: ReturnType<typeof init>

async function workflowStepNames(runId: string) {
  const directory = resolve(process.cwd(), ".workflow-data", "steps")
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const files = (await readdir(directory))
      .filter(file => file.startsWith(runId) && file.endsWith(".json"))
    const rows = await Promise.all(files.map(async file =>
      JSON.parse(await readFile(resolve(directory, file), "utf8")) as {
        stepName: string
        createdAt: string
      }))
    if (rows.length >= 4) {
      return rows
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(row => row.stepName.split("//").at(-1) ?? row.stepName)
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 50))
  }
  return []
}

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
  const stored = await ContextHandle.create(runtime, {
    key: `reactor-workflow:${randomUUID()}`,
    content: { prefix: "workflow" },
  })
  const context = new ReactorWorkflowContext(runtime, stored.context)
  const trigger = await Events(runtime).emit(
    reactorWorkflowDomain.events.requested({ message: "hello" }),
    {
      id: randomUUID(),
      contextId: context.id,
      channel: "test",
      createdAt: new Date(),
    },
  )

  const run = await start(reactorWorkflow, [context, trigger])
  const effect = await run.returnValue

  expect(effect.payload).toEqual({ message: "workflow:hello" })
  expect(await workflowStepNames(run.runId)).toEqual([
    "startReaction",
    "agent",
    "emit",
    "finishReaction",
  ])

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
  expect(session.workflowRunId).toBe(run.runId)
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

/* @vitest-environment node */

import { randomUUID } from "node:crypto"

import { init } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { z } from "zod"

import {
  EkairosRuntime,
  defineDomainAction,
  defineEvent,
  domain,
} from "@ekairos/domain"
import {
  ContextHandle,
  Events,
  Part,
  contextDomain,
} from "@ekairos/events"
import {
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import { defineReaction, executeReaction } from "../reaction.ts"
import type {
  ReactionEngine,
  ReactionEngineInput,
} from "../reactor.ts"

const itemSchema = z.object({ sku: z.string(), quantity: z.number() })

const graphDomain = domain("reactionGraph")
  .includes(contextDomain)
  .withSchema({
    entities: {
      reactionGraph_records: i.entity({ value: i.string() }),
    },
    links: {},
    rooms: {},
  })
  .withEvents({
    requested: defineEvent({ payload: z.object({ message: z.string() }) }),
    completed: defineEvent({
      payload: z.object({
        decision: z.string(),
        accepted: z.boolean(),
        datasetCount: z.number(),
      }),
    }),
  })
  .withActions({
    accept: defineDomainAction({
      description: "Accept a typed decision.",
      input: z.object({ requestId: z.string(), decision: z.string(), accepted: z.boolean() }),
      output: z.object({ requestId: z.string(), decision: z.string(), accepted: z.boolean() }),
      async execute({ input }) {
        return input
      },
    }),
  })

class GraphRuntime extends EkairosRuntime<
  { appId: string; adminToken: string },
  typeof graphDomain,
  ReturnType<typeof init>
> {
  readonly datasetCalls: any[] = []

  protected getDomain() { return graphDomain }

  protected async resolveDb(env: { appId: string; adminToken: string }) {
    return init({ ...env, schema: graphDomain.instantSchema(), useDateObjects: true } as any)
  }

  materializeDataset = async (input: any) => {
    this.datasetCalls.push(input)
    const rows = [
      { sku: "A-1", quantity: 2 },
      { sku: "B-2", quantity: 1 },
    ]
    return {
      datasetId: input.spec.datasetId,
      mode: "built" as const,
      previewRows: rows,
      count: rows.length,
      reader: {
        async read() { return { rows, cursor: rows.length, done: true } },
      },
    }
  }
}

class GraphEngine implements ReactionEngine<Record<string, unknown>> {
  readonly calls: ReactionEngineInput[] = []

  async agent(input: ReactionEngineInput<any, any>) {
    this.calls.push(input)
    const selected = input.given.map(event => event.payload)
    let output: unknown
    if (input.instruction === "normalize") {
      output = { normalized: String((selected[0] as any).message).toUpperCase() }
    } else if (input.instruction === "items") {
      output = { itemCount: 2 }
    } else if (input.instruction === "risks") {
      output = { risk: "low" }
    } else {
      output = {
        decision: `${(selected[0] as any).itemCount}:${(selected[1] as any).risk}`,
      }
    }
    return {
      output,
      parts: [Part.message(JSON.stringify(output))],
      metadata: { engine: "graph-test" },
    }
  }
}

describe("Reaction Event graph", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "reaction-event-graph",
      schema: graphDomain.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({ ...app, schema: graphDomain.instantSchema(), useDateObjects: true } as any)
  }, 60_000)

  afterAll(async () => {
    await destroyContextTestApp(appId)
  }, 60_000)

  itInstant("persists fan-out, ordered fan-in, Dataset, action, and emit as Reactions over Events", async () => {
    const runtime = new GraphRuntime({ appId, adminToken })
    const context = await ContextHandle.create(runtime, {
      key: `reaction:${randomUUID()}`,
      content: { requisitionId: "REQ-1", version: 3 },
    })
    const trigger = await Events(runtime).emit(
      graphDomain.events.requested({ message: "quote this" }),
      { contextId: context.id, channel: "web" },
    )
    const engine = new GraphEngine()
    let fanInIds: string[] = []
    const definition = defineReaction(
      graphDomain.events.requested,
      {
        key: "reactionGraph.answer",
        scope: graphDomain,
        engine,
        sandbox: false,
      },
      async reaction => {
        const normalized = await reaction.given(reaction.trigger).agent({
          instruction: "normalize",
          output: z.object({ normalized: z.string() }),
        })
        const [items, risks, dataset] = await Promise.all([
          reaction.given(normalized).agent({
            instruction: "items",
            output: z.object({ itemCount: z.number() }),
          }),
          reaction.given(normalized).agent({
            instruction: "risks",
            output: z.object({ risk: z.string() }),
          }),
          reaction.given(normalized).dataset({
            instruction: "extract items",
            schema: itemSchema,
          }),
        ])
        fanInIds = [items.id, risks.id, dataset.id]
        const decision = await reaction.given([items, risks, dataset]).agent({
          instruction: "decide",
          output: z.object({ decision: z.string() }),
        })
        const accepted = await reaction.given(decision).action(
          graphDomain.actions.accept.scope({ requestId: "REQ-1" }),
          { decision: decision.payload.decision, accepted: true },
        )
        return await reaction.given(accepted).emit(
          graphDomain.events.completed({
            decision: accepted.payload.decision,
            accepted: accepted.payload.accepted,
            datasetCount: dataset.payload.count ?? dataset.payload.preview.length,
          }),
        )
      },
    )

    const completed = await executeReaction(runtime, context, trigger, definition)
    expect(completed.payload).toEqual({
      decision: "2:low",
      accepted: true,
      datasetCount: 2,
    })
    expect(runtime.datasetCalls).toHaveLength(1)
    expect(runtime.datasetCalls[0].sessionId).toBeTruthy()
    expect(runtime.datasetCalls[0].reactionId).toBeTruthy()
    expect(runtime.datasetCalls[0].spec.ensure.source.rows).toEqual([
      { normalized: "QUOTE THIS" },
    ])

    const graph = await db.query({
      context_sessions: {
        $: { where: { context: context.id } },
        trigger: {},
        rootReaction: { causes: {}, effects: {} },
        reactions: {
          causes: {},
          effects: {
            eventParts: { $: { order: { index: "asc" } } },
          },
          parent: {},
        },
      },
    } as any)
    const session = (graph as any).context_sessions[0]
    expect(session.status).toBe("completed")
    const sessionTrigger = Array.isArray(session.trigger) ? session.trigger[0] : session.trigger
    const rootReaction = Array.isArray(session.rootReaction)
      ? session.rootReaction[0]
      : session.rootReaction
    expect(sessionTrigger.id).toBe(trigger.id)
    expect(rootReaction.effects[0].id).toBe(completed.id)
    expect(session.reactions).toHaveLength(8)

    const byType = new Map(session.reactions.map((row: any) => [row.type, row]))
    expect([...byType.keys()]).toEqual(expect.arrayContaining([
      "agent",
      "dataset",
      "action",
      "emit",
      "reactionGraph.answer",
    ]))
    const decisionReaction = session.reactions.find((row: any) =>
      row.instruction === "decide")
    expect(decisionReaction.causeIds).toEqual(fanInIds)
    expect(decisionReaction.causes.map((row: any) => row.id)).toEqual(
      expect.arrayContaining(decisionReaction.causeIds),
    )
    const actionReaction = session.reactions.find((row: any) => row.type === "action")
    const actionParts = actionReaction.effects[0].eventParts
      .map((part: any) => part.content)
    expect(actionParts.map((part: any) => part.status)).toEqual(["started", "completed"])
  }, 60_000)
})

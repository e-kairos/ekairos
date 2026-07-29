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
  consumeReactionStream,
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
      const itemFacts = selected.find(value =>
        typeof value === "object" && value !== null && "itemCount" in value)
      const riskFacts = selected.find(value =>
        typeof value === "object" && value !== null && "risk" in value)
      output = {
        decision: `${(itemFacts as any).itemCount}:${(riskFacts as any).risk}`,
      }
    }
    await input.stream?.emit({
      kind: "text.delta",
      round: 0,
      partId: "graph-engine-output",
      delta: JSON.stringify(output),
      provider: "graph-test",
      providerType: "result",
    })
    return {
      output,
      parts: [Part.message(JSON.stringify(output))],
      metadata: { engine: "graph-test" },
    }
  }
}

class DatasetAwareEngine implements ReactionEngine<Record<string, unknown>> {
  readonly actionNames: string[] = []

  constructor(private readonly expectDataset: boolean) {}

  async agent(input: ReactionEngineInput<any, any>) {
    this.actionNames.push(...Object.keys(input.actions))
    const materialize = input.actions["dataset.materialize"]
    const read = input.actions["dataset.read"]
    if (!this.expectDataset) {
      if (materialize || read) throw new Error("dataset_capability_should_be_disabled")
      return { output: "Dataset disabled.", parts: [Part.message("Dataset disabled.")] }
    }
    if (!materialize) throw new Error("dataset_capability_missing")
    if (!read) throw new Error("dataset_read_capability_missing")

    const result = await materialize.execute({
      title: "Relevant records",
      instructions: "Snapshot the records needed for the answer.",
    }, input.reactionId, {
      actionCallId: "dataset-call-1",
      round: 0,
      callIndex: 0,
    }) as any

    const output = `Dataset ${result.datasetId} contains ${result.count} rows.`
    return { output, parts: [Part.message(output)] }
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
    const decisionCall = engine.calls.find(call => call.instruction === "decide")
    expect(decisionCall?.given.map(event => event.payload)).toEqual([
      { message: "quote this" },
      { normalized: "QUOTE THIS" },
      { itemCount: 2 },
      { risk: "low" },
      {
        datasetId: expect.any(String),
        mode: "built",
        preview: [
          { sku: "A-1", quantity: 2 },
          { sku: "B-2", quantity: 1 },
        ],
        count: 2,
      },
    ])
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
          stream: {},
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

    const streamedReactions = session.reactions.filter((row: any) => row.type === "agent")
    expect(streamedReactions).toHaveLength(4)
    expect(streamedReactions.every((row: any) =>
      row.streamId && row.streamClientId && row.stream?.id === row.streamId)).toBe(true)
    const trace: any[] = []
    await consumeReactionStream({
      db,
      streamId: streamedReactions[0].streamId,
      clientId: streamedReactions[0].streamClientId,
      signal: new AbortController().signal,
      onChunk: chunk => { trace.push(chunk) },
    })
    expect(trace.map(chunk => chunk.kind)).toEqual([
      "reaction.started",
      "model.round.started",
      "text.delta",
      "model.round.completed",
      "reaction.completed",
    ])
    expect(streamedReactions.every((row: any) =>
      row.effects.every((event: any) => event.type === "context.model"))).toBe(true)

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

  itInstant("gives agent a scoped Dataset capability by default and supports explicit opt-out", async () => {
    const runtime = new GraphRuntime({ appId, adminToken })
    const context = await ContextHandle.create(runtime, {
      key: `reaction-dataset-agent:${randomUUID()}`,
      content: { purpose: "dataset-agent" },
    })
    const trigger = await Events(runtime).emit(
      graphDomain.events.requested({ message: "Summarize every record." }),
      { contextId: context.id, channel: "web" },
    )
    const enabledEngine = new DatasetAwareEngine(true)
    const enabled = defineReaction(
      graphDomain.events.requested,
      {
        key: "reactionGraph.dataset-agent",
        scope: graphDomain,
        engine: enabledEngine,
        sandbox: false,
      },
      async reaction => await reaction.given(reaction.trigger).agent({
        instruction: "Use a Dataset when the answer requires a collection.",
      }),
    )

    const answer = await executeReaction(runtime, context, trigger, enabled)
    expect(answer.payload).toContain("contains 2 rows")
    expect(enabledEngine.actionNames).toContain("dataset.materialize")
    expect(enabledEngine.actionNames).toContain("dataset.read")
    expect(runtime.datasetCalls).toHaveLength(1)
    expect(runtime.datasetCalls[0].spec.ensure).toMatchObject({
      title: "Relevant records",
      source: {
        rows: [{ message: "Summarize every record." }],
      },
      instructions: "Snapshot the records needed for the answer.",
    })

    const disabledEngine = new DatasetAwareEngine(false)
    const disabled = defineReaction(
      graphDomain.events.requested,
      {
        key: "reactionGraph.dataset-agent-disabled",
        scope: graphDomain,
        engine: disabledEngine,
        sandbox: false,
      },
      async reaction => await reaction.given(reaction.trigger).agent({
        instruction: "Answer without Dataset materialization.",
        datasets: false,
      }),
    )
    const disabledAnswer = await executeReaction(runtime, context, trigger, disabled)
    expect(disabledAnswer.payload).toBe("Dataset disabled.")
    expect(disabledEngine.actionNames).not.toContain("dataset.materialize")
    expect(disabledEngine.actionNames).not.toContain("dataset.read")
  }, 60_000)
})

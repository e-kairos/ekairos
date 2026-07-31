/* @vitest-environment node */
// Runnable proof of the canonical Context(...).session + Session.from flow.

import { randomUUID } from "node:crypto"

import { init } from "@instantdb/admin"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { z } from "zod"

import { EkairosRuntime, defineEvent, domain } from "@ekairos/domain"
import { ContextHandle, Part, contextDomain } from "@ekairos/events"
import { Context } from "../../../context/src/index.ts"
import {
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import type { ReactionEngine, ReactionEngineInput } from "../reactor.ts"

const rocket = domain("rocketTriageRunnable")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    messageReceived: defineEvent({ payload: z.object({ text: z.string() }) }),
  })
const coaching = rocket.scope({
  events: [rocket.events.messageReceived],
  actions: [],
})

class RunnableRuntime extends EkairosRuntime<
  { appId: string; adminToken: string },
  typeof rocket,
  ReturnType<typeof init>
> {
  protected getDomain() { return rocket }
  protected async resolveDb(env: { appId: string; adminToken: string }) {
    return init({ ...env, schema: rocket.instantSchema(), useDateObjects: true } as any)
  }
  materializeDataset = async (input: any) => {
    const rows = [{ t: 24, boost: 12 }, { t: 26, boost: 4 }]
    return {
      datasetId: input.spec.datasetId,
      mode: "built" as const,
      previewRows: rows,
      count: rows.length,
      reader: { async read() { return { rows, cursor: rows.length, done: true } } },
    }
  }
}

class CoachEngine implements ReactionEngine<Record<string, unknown>> {
  async agent(input: ReactionEngineInput<any, any>) {
    const output = input.instruction === "triage"
      ? { plays: [{ from: 20, to: 30, reason: "gol rival" }] }
      : input.instruction.startsWith("analyze")
        ? { analysis: "Boost bajo antes del desafio." }
        : { feedback: "Conserva boost y rota antes." }
    return { output, parts: [Part.json(output)] }
  }
}

describe("rocket triage runnable flat Session", () => {
  let appId = ""
  let adminToken = ""

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "rocket-triage-runnable-flat",
      schema: rocket.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
  }, 60_000)

  afterAll(async () => destroyContextTestApp(appId), 60_000)

  itInstant("forks Dataset analysis and joins the resulting causal cone", async () => {
    const runtime = new RunnableRuntime({ appId, adminToken })
    const contextKey = `rocket:${randomUUID()}`
    await ContextHandle.open(runtime, {
      key: contextKey,
      content: { score: [2, 1], player: "VFex" },
    })
    await using session = await Context(runtime).session(
      contextKey,
      coaching,
      new CoachEngine(),
      { sandbox: false },
    )
    const triage = await session.from(
      rocket.events.messageReceived({ text: "Analiza el gol rival." }),
    ).agent({
      instruction: "triage",
      output: z.object({
        plays: z.array(z.object({
          from: z.number(),
          to: z.number(),
          reason: z.string(),
        })),
      }),
      datasets: false,
    })
    const analyses = await Promise.all(triage.payload.plays.map(async play => {
      const frames = await session.from(triage).dataset({
        instruction: `frames ${play.from}-${play.to}`,
        schema: z.object({ t: z.number(), boost: z.number() }),
      })
      return await session.from([triage, frames]).agent({
        instruction: `analyze ${play.reason}`,
        output: z.object({ analysis: z.string() }),
      })
    }))
    const final = await session.from(analyses).agent({
      instruction: "synthesize",
      output: z.object({ feedback: z.string() }),
      datasets: false,
    })
    expect(final.payload.feedback).toContain("boost")
    const graph = await (await runtime.db()).query({
      context_sessions: {
        $: { where: { context: session.context.id } },
        rootReaction: { effects: {} },
        reactions: { causes: {}, effects: {} },
      },
    } as any)
    const stored = graph.context_sessions[0]
    expect(stored.rootReaction.effects[0].id).toBe(final.id)
    expect(stored.reactions.some((reaction: any) => reaction.causeIds.length === 2)).toBe(true)
  }, 60_000)
})

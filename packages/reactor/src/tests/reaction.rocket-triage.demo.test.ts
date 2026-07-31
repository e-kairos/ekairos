/* @vitest-environment node */
// Canonical live demo: Context(...).session + flat Session.from fan-out/join.

import { randomUUID } from "node:crypto"

import { init } from "@instantdb/admin"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { z } from "zod"

import { EkairosRuntime, defineEvent, domain } from "@ekairos/domain"
import { ContextHandle, contextDomain } from "@ekairos/events"
import { Context } from "../../../context/src/index.ts"
import {
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import { ai } from "../reactor.ts"

const MODEL = "anthropic/claude-haiku-4.5"
const rocketDemo = domain("rocketTriageDemo")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    messageReceived: defineEvent({ payload: z.object({ text: z.string() }) }),
  })
const coaching = rocketDemo.scope({
  events: [rocketDemo.events.messageReceived],
  actions: [],
})

type MatchContext = {
  replay: { mapName: string; score: [number, number]; player: string }
  timeline: Array<{ time: number; kind: string; team: string; player: string }>
}

const MATCH: MatchContext = {
  replay: { mapName: "TrainStation_Night_P", score: [2, 1], player: "VFex" },
  timeline: [
    { time: 24, kind: "goal", team: "orange", player: "Mohamedmama2" },
    { time: 158, kind: "save", team: "blue", player: "VFex" },
    { time: 322, kind: "goal", team: "blue", player: "Follow the Beat" },
    { time: 405, kind: "goal", team: "blue", player: "VFex" },
  ],
}

class DemoRuntime extends EkairosRuntime<
  { appId: string; adminToken: string },
  typeof rocketDemo,
  ReturnType<typeof init>
> {
  readonly datasetWindows: string[] = []
  protected getDomain() { return rocketDemo }
  protected async resolveDb(env: { appId: string; adminToken: string }) {
    return init({ ...env, schema: rocketDemo.instantSchema(), useDateObjects: true } as any)
  }
  materializeDataset = async (input: any) => {
    this.datasetWindows.push(input.spec.ensure.instructions)
    const rows = [
      { t: 0, player: "VFex", boost: 78, distToBall: 5291, distToOwnGoal: 5371 },
      { t: 2, player: "VFex", boost: 44, distToBall: 2130, distToOwnGoal: 4820 },
      { t: 4, player: "VFex", boost: 12, distToBall: 640, distToOwnGoal: 4100 },
    ]
    return {
      datasetId: input.spec.datasetId,
      mode: "built" as const,
      previewRows: rows,
      count: rows.length,
      reader: { async read() { return { rows, cursor: rows.length, done: true } } },
    }
  }
}

async function runCoach(
  runtime: DemoRuntime,
  contextKey: string,
  message: string,
) {
  await using session = await Context(runtime).session(
    contextKey,
    coaching,
    ai({ model: MODEL }),
    { sandbox: false },
  )
  const triage = await session.from(
    rocketDemo.events.messageReceived({ text: message }),
  ).agent({
    instruction: [
      "Sos el analista post-partido de Rocket League de VFex.",
      JSON.stringify(session.context.content),
      `Mensaje: ${message}`,
      "Responde mode=chat para charla trivial o mode=analyze con 1 a 3 ventanas relevantes.",
    ].join("\n"),
    output: z.object({
      mode: z.enum(["chat", "analyze"]),
      reply: z.string().optional(),
      plays: z.array(z.object({
        from: z.number(),
        to: z.number(),
        reason: z.string(),
      })).max(3).optional(),
    }),
    datasets: false,
  })
  if (triage.payload.mode === "chat") {
    return triage
  }

  const analyses = await Promise.all((triage.payload.plays ?? []).map(async play => {
    const frames = await session.from(triage).dataset({
      instruction: `Snapshots de ${play.from}s a ${play.to}s: posiciones, boost y distancias de VFex.`,
      schema: z.object({
        t: z.number(),
        player: z.string(),
        boost: z.number(),
        distToBall: z.number(),
        distToOwnGoal: z.number(),
      }),
    })
    return await session.from([triage, frames]).agent({
      instruction: `Analiza la jugada ${play.from}-${play.to}s (${play.reason}) con evidencia del dataset.`,
      output: z.object({
        analysis: z.string(),
        verdict: z.enum(["bien", "mejorable", "error"]),
      }),
    })
  }))
  const final = await session.from(analyses).agent({
    instruction: "Sintetiza un parrafo de feedback y dos prioridades para VFex.",
    output: z.object({ feedback: z.string() }),
    datasets: false,
  })
  return final
}

describe("rocket triage flat Session demo (live)", () => {
  let appId = ""
  let adminToken = ""

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "rocket-triage-flat-demo",
      schema: rocketDemo.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
  }, 120_000)

  afterAll(async () => destroyContextTestApp(appId), 60_000)

  itInstant("chat trivial completes without a Dataset", async () => {
    const runtime = new DemoRuntime({ appId, adminToken })
    const contextKey = `demo:${randomUUID()}`
    await ContextHandle.open(runtime, {
      key: contextKey,
      content: MATCH,
    })
    const final = await runCoach(runtime, contextKey, "hola coach, como salio?")
    expect(final.type).toBe("context.model")
    expect(runtime.datasetWindows).toHaveLength(0)
  }, 240_000)

  itInstant("analysis fans out from triage and joins analyses for synthesis", async () => {
    const runtime = new DemoRuntime({ appId, adminToken })
    const contextKey = `demo:${randomUUID()}`
    await ContextHandle.open(runtime, {
      key: contextKey,
      content: MATCH,
    })
    const final = await runCoach(
      runtime,
      contextKey,
      "analizame los goles del partido y decime que hice mal",
    )
    expect(final.type).toBe("context.model")
    expect((final.payload as any).feedback).toEqual(expect.any(String))
    expect(runtime.datasetWindows.length).toBeGreaterThanOrEqual(1)
  }, 360_000)
})

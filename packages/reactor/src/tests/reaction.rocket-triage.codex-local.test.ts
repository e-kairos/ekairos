/* @vitest-environment node */
// Live-gated canonical flat Session demo using Codex local as the engine.

import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { init } from "@instantdb/admin"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { z } from "zod"

import { EkairosRuntime, defineEvent, domain } from "@ekairos/domain"
import { ContextHandle, contextDomain } from "@ekairos/events"
import { Context } from "../../../context/src/index.ts"
import { codexEngine } from "../../../reactors/openai-reactor/src/codex.engine.ts"
import {
  createSandboxSession,
  localSandbox,
  type SandboxSession,
} from "../../../sandbox/src/session.ts"
import {
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import type { ReactionEngine, ReactionEngineInput } from "../reactor.ts"

const CODEX_HOME = "C:\\Users\\aleja\\.codex"
const CODEX_BIN = "C:\\Users\\aleja\\AppData\\Local\\OpenAI\\Codex\\bin\\69066b736e1e17a4"
const rocket = domain("rocketTriageCodex")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    messageReceived: defineEvent({ payload: z.object({ text: z.string() }) }),
  })
const coaching = rocket.scope({
  events: [rocket.events.messageReceived],
  actions: [],
})

class LocalCodexEngine implements ReactionEngine<unknown> {
  constructor(private readonly sandbox: SandboxSession) {}
  async agent(input: ReactionEngineInput<unknown, unknown>) {
    return await codexEngine({
      bridgePort: 4599,
      installCodexCli: false,
      auth: { source: "preinstalled", codexHome: CODEX_HOME },
    }).agent({ ...input, sandbox: this.sandbox as never })
  }
}

class DemoRuntime extends EkairosRuntime<
  { appId: string; adminToken: string },
  typeof rocket,
  ReturnType<typeof init>
> {
  readonly windows: string[] = []
  protected getDomain() { return rocket }
  protected async resolveDb(env: { appId: string; adminToken: string }) {
    return init({ ...env, schema: rocket.instantSchema(), useDateObjects: true } as any)
  }
  materializeDataset = async (input: any) => {
    this.windows.push(input.spec.ensure.instructions)
    const rows = [{ t: 322, boost: 12 }, { t: 324, boost: 4 }]
    return {
      datasetId: input.spec.datasetId,
      mode: "built" as const,
      previewRows: rows,
      count: rows.length,
      reader: { async read() { return { rows, cursor: rows.length, done: true } } },
    }
  }
}

describe("rocket triage flat Session (Codex local live)", () => {
  let appId = ""
  let adminToken = ""
  let sandbox: SandboxSession

  beforeAll(async () => {
    sandbox = await createSandboxSession(localSandbox({
      basePath: join(tmpdir(), `ekairos-codex-demo-${randomUUID().slice(0, 8)}`),
      env: {
        PATH: [
          CODEX_BIN,
          "C:\\Program Files\\Git\\bin",
          "C:\\Program Files\\Git\\usr\\bin",
          process.env.PATH ?? "",
        ].join(";"),
        CODEX_HOME,
      },
    }))
    const app = await provisionContextTestApp({
      name: "rocket-triage-codex-flat",
      schema: rocket.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
  }, 120_000)

  afterAll(async () => {
    await destroyContextTestApp(appId)
    await sandbox?.stop().catch(() => undefined)
  }, 60_000)

  itInstant("forks Dataset-backed analyses and joins them into final coaching", async () => {
    const runtime = new DemoRuntime({ appId, adminToken })
    const contextKey = `codex-rocket:${randomUUID()}`
    await ContextHandle.open(runtime, {
      key: contextKey,
      content: {
        score: [2, 1],
        player: "VFex",
        timeline: [{ time: 322, kind: "goal", team: "blue" }],
      },
    })
    await using session = await Context(runtime).session(
      contextKey,
      coaching,
      new LocalCodexEngine(sandbox),
      { sandbox: false },
    )
    const triage = await session.from(
      rocket.events.messageReceived({
        text: "Analiza los goles y dame dos prioridades.",
      }),
    ).agent({
      instruction: "Elige 1 o 2 ventanas del timeline para analizar.",
      output: z.object({
        plays: z.array(z.object({
          from: z.number(),
          to: z.number(),
          reason: z.string(),
        })).min(1).max(2),
      }),
      datasets: false,
    })
    const analyses = await Promise.all(triage.payload.plays.map(async play => {
      const frames = await session.from(triage).dataset({
        instruction: `Frames ${play.from}-${play.to}`,
        schema: z.object({ t: z.number(), boost: z.number() }),
      })
      return await session.from([triage, frames]).agent({
        instruction: `Analiza ${play.reason} usando los frames.`,
        output: z.object({ analysis: z.string() }),
      })
    }))
    const final = await session.from(analyses).agent({
      instruction: "Sintetiza feedback y dos prioridades.",
      output: z.object({ feedback: z.string() }),
      datasets: false,
    })
    expect(final.payload.feedback).toEqual(expect.any(String))
    expect(runtime.windows.length).toBeGreaterThanOrEqual(1)
  }, 900_000)
})

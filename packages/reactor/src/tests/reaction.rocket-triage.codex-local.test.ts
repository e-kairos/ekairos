/* @vitest-environment node */
// DEMO (borrable): igual que reaction.rocket-triage.runnable.test.ts pero con
// CODEX LOCAL como engine del defineReaction (CodexEngine + localSandbox).
// Modelo: gpt-5.6-sol de la suscripcion codex del usuario. Sin mocks de LLM.

import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { init } from "@instantdb/admin"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { z } from "zod"

import { EkairosRuntime, defineEvent, domain } from "@ekairos/domain"
import { ContextHandle, Events, consumeReactionStream, contextDomain } from "@ekairos/events"
import { codexEngine } from "../../../reactors/openai-reactor/src/codex.engine.ts"
import { createSandboxSession, localSandbox, type SandboxSession } from "../../../sandbox/src/session.ts"
import {
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import { defineReaction, executeReaction } from "../reaction.ts"
import type { ReactionEngine, ReactionEngineInput } from "../reactor.ts"

const CODEX_MODEL = "gpt-5.6-sol"
const CODEX_HOME = "C:\\Users\\aleja\\.codex"
// subdir versionado = codex-cli 0.146 (el codex.exe de bin\ raiz es 0.130 y
// rechaza gpt-5.6-sol con "requires a newer version of Codex")
const CODEX_BIN = "C:\\Users\\aleja\\AppData\\Local\\OpenAI\\Codex\\bin\\69066b736e1e17a4"
const GIT_BIN = "C:\\Program Files\\Git\\bin"
const GIT_USR_BIN = "C:\\Program Files\\Git\\usr\\bin"
const BRIDGE_PORT = 4599

// Engine: delega en CodexEngine inyectando una session de sandbox LOCAL creada
// directamente (bypass de Sandbox.open/sandboxDomain — la reaction declara
// sandbox: false y el sandbox es un detalle interno del engine en este demo).
class LocalCodexEngine implements ReactionEngine<unknown> {
  constructor(private readonly session: SandboxSession) {}

  async agent(input: ReactionEngineInput<unknown, unknown>) {
    // sin model override: el app-server usa el default del config.toml del
    // CODEX_HOME (gpt-5.6-sol); el override explicito da 400 por esta via
    const engine = codexEngine({
      bridgePort: BRIDGE_PORT,
      installCodexCli: false,
      auth: { source: "preinstalled", codexHome: CODEX_HOME },
    })
    return await engine.agent({ ...input, sandbox: this.session as never })
  }
}

async function createLocalCodexSession(): Promise<SandboxSession> {
  return await createSandboxSession(
    localSandbox({
      basePath: join(tmpdir(), `ekairos-codex-demo-${randomUUID().slice(0, 8)}`),
      env: {
        PATH: [CODEX_BIN, GIT_BIN, GIT_USR_BIN, process.env.PATH ?? ""].join(";"),
        CODEX_HOME,
      },
    }),
  )
}

const rocketDemo = domain("rocketTriageCodex")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    messageReceived: defineEvent({ payload: z.object({ text: z.string() }) }),
    playDetected: defineEvent({
      payload: z.object({ from: z.number(), to: z.number(), reason: z.string() }),
    }),
    assistantReplied: defineEvent({ payload: z.object({ text: z.string() }) }),
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
  readonly datasetWindows: Array<{ instruction: string }> = []

  protected getDomain() { return rocketDemo }

  protected async resolveDb(env: { appId: string; adminToken: string }) {
    return init({ ...env, schema: rocketDemo.instantSchema(), useDateObjects: true } as any)
  }

  materializeDataset = async (input: any) => {
    this.datasetWindows.push({ instruction: input.spec?.ensure?.instructions ?? input.spec?.instructions ?? "?" })
    const rows = [
      { t: 0, player: "VFex", boost: 78, distToBall: 5291, distToOwnGoal: 5371 },
      { t: 2, player: "VFex", boost: 44, distToBall: 2130, distToOwnGoal: 4820 },
      { t: 4, player: "VFex", boost: 12, distToBall: 640, distToOwnGoal: 4100 },
    ]
    return {
      datasetId: randomUUID(),
      mode: "built" as const,
      previewRows: rows,
      count: rows.length,
      reader: { async read() { return { rows, cursor: rows.length, done: true } } },
    }
  }
}

function createPlayAnalysisReaction(engine: LocalCodexEngine) {
  return defineReaction(
    rocketDemo.events.playDetected,
    {
      key: "rocketCodex.play-analysis",
      scope: rocketDemo,
      engine,
      sandbox: false,
    },
    async reaction => {
      const { from, to, reason } = reaction.trigger.payload as { from: number; to: number; reason: string }
      const frames = await reaction.given(reaction.trigger).dataset({
        instruction: `Snapshots de ${from}s a ${to}s del replay: posiciones, boost y distancias de VFex.`,
        schema: z.object({ t: z.number(), player: z.string(), boost: z.number(), distToBall: z.number(), distToOwnGoal: z.number() }),
      })
      return reaction.given([reaction.trigger, frames]).agent({
        instruction: [
          `Analiza SOLO la jugada de ${from}s a ${to}s (motivo: ${reason}) del partido de Rocket League.`,
          "Usa las filas del dataset como evidencia. 2-3 oraciones en español, tono coach.",
        ].join(" "),
        output: z.object({ analysis: z.string(), verdict: z.enum(["bien", "mejorable", "error"]) }),
      })
    },
  )
}

function createAnalystReaction(engine: LocalCodexEngine) {
  const playAnalysisReaction = createPlayAnalysisReaction(engine)
  return defineReaction(
    rocketDemo.events.messageReceived,
    {
      key: "rocketCodex.analyst",
      scope: rocketDemo,
      engine,
      sandbox: false,
    },
    async reaction => {
      const content = reaction.context.content as MatchContext
      const triage = await reaction.given(reaction.trigger).agent({
        instruction: [
          "Sos el analista post-partido de Rocket League de VFex. Este es el contexto del partido:",
          JSON.stringify(content),
          `Mensaje del usuario: "${(reaction.trigger.payload as { text: string }).text}"`,
          "Decidí el modo:",
          "- chat: saludo o pregunta trivial que responden el timeline y el marcador; contesta en reply.",
          "- clarify: falta información imprescindible para analizar; formula question.",
          "- analyze: pide análisis de jugadas; elegí 1 a 3 ventanas [from,to] en segundos alrededor de los momentos relevantes del timeline, con reason.",
          'IMPORTANTE: respeta EXACTAMENTE las claves del schema de salida. Para analyze la clave es "plays" (no "windows" ni otra): {"mode":"analyze","plays":[{"from":10,"to":40,"reason":"..."}]}.',
        ].join("\n"),
        output: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("chat"), reply: z.string() }),
          z.object({ mode: z.literal("clarify"), question: z.string() }),
          z.object({
            mode: z.literal("analyze"),
            plays: z.array(z.object({ from: z.number(), to: z.number(), reason: z.string() })).min(1).max(3),
          }),
        ]),
        datasets: false,
      })

      const decision = triage.payload as
        | { mode: "chat"; reply: string }
        | { mode: "clarify"; question: string }
        | { mode: "analyze"; plays: Array<{ from: number; to: number; reason: string }> }

      if (decision.mode === "chat" || decision.mode === "clarify") {
        return reaction.given(triage).emit(
          rocketDemo.events.assistantReplied({
            text: decision.mode === "chat" ? decision.reply : decision.question,
          }),
        )
      }

      const analyses = await Promise.all(decision.plays.map(async play => {
        const playEvent = await reaction.given(triage).emit(rocketDemo.events.playDetected(play))
        return reaction.react(playEvent, playAnalysisReaction)
      }))

      const synthesis = await reaction.given([reaction.trigger, ...analyses.flat()]).agent({
        instruction: "Sintetiza los análisis de jugadas en un feedback de coach para VFex: 1 párrafo + 2 prioridades. Español.",
        output: z.object({ feedback: z.string() }),
        datasets: false,
      })
      return reaction.given(synthesis).emit(
        rocketDemo.events.assistantReplied({ text: (synthesis.payload as { feedback: string }).feedback }),
      )
    },
  )
}

// tail de streaming amigable (mismo patron que la variante ai-gateway)
function startStreamTail(db: any, contextId: string) {
  const abort = new AbortController()
  const seen = new Set<string>()
  const labels = new Map<string, string>()
  let lastWriter = ""

  const write = (streamId: string, text: string) => {
    if (lastWriter !== streamId) {
      const label = labels.get(streamId) ?? streamId.slice(0, 8)
      process.stdout.write(`\n┌─ ${label}\n│ `)
      lastWriter = streamId
    }
    process.stdout.write(text.replaceAll("\n", "\n│ "))
  }

  const printChunk = (streamId: string) => (chunk: any) => {
    if (chunk.kind === "model.round.started") write(streamId, `⟳ ronda ${chunk.round} (codex local pensando...)\n`)
    else if (chunk.kind === "text.delta" || chunk.kind === "reasoning.delta") write(streamId, chunk.delta ?? "")
    else if (chunk.kind === "action.started") write(streamId, `\n⚙ ${chunk.actionName ?? "action"} ${JSON.stringify(chunk.input ?? {}).slice(0, 160)}\n`)
    else if (chunk.kind === "action.completed") write(streamId, `✔ ${chunk.actionName ?? "action"}\n`)
    else if (chunk.kind === "action.failed") write(streamId, `✖ ${chunk.actionName ?? "action"} ${JSON.stringify(chunk.error ?? {}).slice(0, 160)}\n`)
    else if (chunk.kind === "model.round.completed") write(streamId, "\n")
  }

  const loop = (async () => {
    while (!abort.signal.aborted) {
      try {
        const graph = await db.query({
          context_sessions: {
            $: { where: { context: contextId } },
            reactions: {},
            children: { reactions: {} },
          },
        } as any)
        const sessions = (graph as any).context_sessions ?? []
        const reactions = sessions.flatMap((row: any) => [
          ...(row.reactions ?? []),
          ...(row.children ?? []).flatMap((child: any) => child.reactions ?? []),
        ])
        for (const reaction of reactions) {
          const streamId = reaction.streamId
          if (!streamId || seen.has(streamId)) continue
          seen.add(streamId)
          labels.set(streamId, `${reaction.type}${reaction.instruction ? `: ${String(reaction.instruction).slice(0, 60)}` : ""}`)
          void consumeReactionStream({
            db,
            signal: abort.signal,
            streamId,
            onChunk: printChunk(streamId),
          }).catch(() => undefined)
        }
      } catch { /* polling: reintenta */ }
      await new Promise(resolve => setTimeout(resolve, 400))
    }
  })()

  return {
    async stop() {
      await new Promise(resolve => setTimeout(resolve, 800))
      abort.abort()
      await loop.catch(() => undefined)
      process.stdout.write("\n")
    },
  }
}

describe("rocket triage demo (CODEX LOCAL como engine)", () => {
  let appId = ""
  let adminToken = ""
  let session: SandboxSession

  beforeAll(async () => {
    session = await createLocalCodexSession()
    const app = await provisionContextTestApp({
      name: "rocket-triage-codex",
      schema: rocketDemo.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
  }, 120_000)

  afterAll(async () => {
    await destroyContextTestApp(appId)
    await session?.stop().catch(() => undefined)
  }, 60_000)

  itInstant("chat trivial: codex local responde sin analizar", async () => {
    const engine = new LocalCodexEngine(session)
    const runtime = new DemoRuntime({ appId, adminToken })
    const context = await ContextHandle.create(runtime, {
      key: `demo:${randomUUID()}`,
      content: MATCH,
    })
    const trigger = await Events(runtime).emit(
      rocketDemo.events.messageReceived({ text: "hola coach! como salio el partido?" }),
      { contextId: context.id, channel: "test" },
    )
    const db = init({ appId, adminToken, schema: rocketDemo.instantSchema(), useDateObjects: true } as any)
    const tail = startStreamTail(db, context.id)
    const effect = await executeReaction(runtime, context, trigger, createAnalystReaction(engine))
      .finally(() => tail.stop())
    const replied = Array.isArray(effect) ? effect[0]! : effect
    console.log("\n[CHAT/codex] respuesta:", JSON.stringify(replied.payload, null, 2))
    expect(replied.name).toBe("assistantReplied")
    expect(runtime.datasetWindows).toHaveLength(0)
  }, 600_000)

  itInstant("analisis: codex local hace fan-out por jugada + sintesis", async () => {
    const engine = new LocalCodexEngine(session)
    const runtime = new DemoRuntime({ appId, adminToken })
    const context = await ContextHandle.create(runtime, {
      key: `demo:${randomUUID()}`,
      content: MATCH,
    })
    const trigger = await Events(runtime).emit(
      rocketDemo.events.messageReceived({
        text: "analizame los goles del partido y decime que hice mal",
      }),
      { contextId: context.id, channel: "test" },
    )
    const db = init({ appId, adminToken, schema: rocketDemo.instantSchema(), useDateObjects: true } as any)
    const tail = startStreamTail(db, context.id)
    const effect = await executeReaction(runtime, context, trigger, createAnalystReaction(engine))
      .finally(() => tail.stop())
    const replied = Array.isArray(effect) ? effect[0]! : effect
    console.log("\n[ANALYZE/codex] ventanas de dataset pedidas:", runtime.datasetWindows.length)
    for (const window of runtime.datasetWindows) console.log("  -", window.instruction)
    console.log("[ANALYZE/codex] feedback final:\n", (replied.payload as { text: string }).text)
    expect(replied.name).toBe("assistantReplied")
    expect(runtime.datasetWindows.length).toBeGreaterThanOrEqual(1)
  }, 900_000)
})

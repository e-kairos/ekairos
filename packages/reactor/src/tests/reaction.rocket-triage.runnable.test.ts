/* @vitest-environment node */
// DEMO (borrable): triage conversacional + fan-out por jugada con defineReaction,
// LLM real (AI Gateway) y app InstantDB de test. Ver rocket-web-replay/AGENTS.md.

import { randomUUID } from "node:crypto"

import { init } from "@instantdb/admin"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { z } from "zod"

import { EkairosRuntime, defineEvent, domain } from "@ekairos/domain"
import { ContextHandle, Events, consumeReactionStream, contextDomain } from "@ekairos/events"
import {
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import { defineReaction, executeReaction } from "../reaction.ts"
import { ai } from "../reactor.ts"

const MODEL = "anthropic/claude-haiku-4.5"

const rocketDemo = domain("rocketTriageDemo")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    messageReceived: defineEvent({ payload: z.object({ text: z.string() }) }),
    playDetected: defineEvent({
      payload: z.object({
        from: z.number(),
        to: z.number(),
        reason: z.string(),
      }),
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

  // mock: "recorta" frames a la ventana pedida (filas sintéticas pero plausibles)
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

const playAnalysisReaction = defineReaction(
  rocketDemo.events.playDetected,
  {
    key: "rocketDemo.play-analysis",
    scope: rocketDemo,
    engine: ai({ model: MODEL }),
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

function createAnalystReaction() {
  return defineReaction(
    rocketDemo.events.messageReceived,
    {
      key: "rocketDemo.analyst",
      scope: rocketDemo,
      engine: ai({ model: MODEL }),
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
        ].join("\n"),
        // variante ejecutable HOY: objeto plano (la union en raiz espera el fix
        // de agnosticismo del engine; ver reaction.rocket-triage.demo.test.ts)
        output: z.object({
          mode: z.enum(["chat", "clarify", "analyze"]),
          reply: z.string().optional().describe("solo para mode=chat"),
          question: z.string().optional().describe("solo para mode=clarify"),
          plays: z.array(z.object({ from: z.number(), to: z.number(), reason: z.string() }))
            .max(3).optional().describe("solo para mode=analyze"),
        }),
        datasets: false,
      })

      const decision = triage.payload as {
        mode: "chat" | "clarify" | "analyze"
        reply?: string
        question?: string
        plays?: Array<{ from: number; to: number; reason: string }>
      }

      if (decision.mode === "chat" || decision.mode === "clarify") {
        return reaction.given(triage).emit(
          rocketDemo.events.assistantReplied({
            text: decision.reply ?? decision.question ?? "",
          }),
        )
      }

      const analyses = await Promise.all((decision.plays ?? []).map(async play => {
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

// ── tail de streaming amigable ──────────────────────────────────────────────
// Mientras la reaccion corre, descubre streams nuevos por polling y consume
// sus chunks en vivo: deltas de texto inline, acciones y rondas como lineas.
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
    if (chunk.kind === "model.round.started") {
      write(streamId, `⟳ ronda ${chunk.round}\n`)
    } else if (chunk.kind === "text.delta" || chunk.kind === "reasoning.delta") {
      write(streamId, chunk.delta ?? "")
    } else if (chunk.kind === "action.started") {
      write(streamId, `\n⚙ ${chunk.actionName ?? "action"} ${JSON.stringify(chunk.input ?? {}).slice(0, 160)}\n`)
    } else if (chunk.kind === "action.completed") {
      write(streamId, `✔ ${chunk.actionName ?? "action"}\n`)
    } else if (chunk.kind === "action.failed") {
      write(streamId, `✖ ${chunk.actionName ?? "action"} ${JSON.stringify(chunk.error ?? {}).slice(0, 160)}\n`)
    } else if (chunk.kind === "model.round.completed") {
      write(streamId, "\n")
    }
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

describe("rocket triage demo (LLM real)", () => {
  let appId = ""
  let adminToken = ""

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "rocket-triage-demo",
      schema: rocketDemo.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
  }, 120_000)

  afterAll(async () => {
    await destroyContextTestApp(appId)
  }, 60_000)

  itInstant("chat trivial: responde sin analizar ni materializar datasets", async () => {
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
    const effect = await executeReaction(runtime, context, trigger, createAnalystReaction())
      .finally(() => tail.stop())
    const replied = Array.isArray(effect) ? effect[0]! : effect
    console.log("\n[CHAT] respuesta:", JSON.stringify(replied.payload, null, 2))
    expect(replied.name).toBe("assistantReplied")
    expect(runtime.datasetWindows).toHaveLength(0)
  }, 240_000)

  itInstant("pedido de análisis: fan-out por jugada elegida por la AI + síntesis", async () => {
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
    const tailDb = init({ appId, adminToken, schema: rocketDemo.instantSchema(), useDateObjects: true } as any)
    const tail = startStreamTail(tailDb, context.id)
    const effect = await executeReaction(runtime, context, trigger, createAnalystReaction())
      .finally(() => tail.stop())
    const replied = Array.isArray(effect) ? effect[0]! : effect
    console.log("\n[ANALYZE] ventanas de dataset pedidas:", runtime.datasetWindows.length)
    for (const window of runtime.datasetWindows) console.log("  -", window.instruction)
    console.log("[ANALYZE] feedback final:\n", (replied.payload as { text: string }).text)
    expect(replied.name).toBe("assistantReplied")
    expect(runtime.datasetWindows.length).toBeGreaterThanOrEqual(1)

    const db = init({ appId, adminToken, schema: rocketDemo.instantSchema(), useDateObjects: true } as any)
    const graph = await db.query({
      context_sessions: {
        $: { where: { context: context.id } },
        reactions: {},
        children: { reactions: {} },
      },
    } as any)
    const sessions = (graph as any).context_sessions ?? []
    const root = sessions.find((row: any) => (row.children ?? []).length > 0) ?? sessions[0]
    console.log(
      "[ANALYZE] sesiones:", sessions.length,
      "| reacciones raiz:", root?.reactions?.length ?? 0,
      "| sesiones hijas:", root?.children?.length ?? 0,
    )
    expect(sessions.length).toBeGreaterThanOrEqual(1)
  }, 360_000)
})

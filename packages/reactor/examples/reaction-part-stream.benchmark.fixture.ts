import { performance } from "node:perf_hooks"

import { init } from "@instantdb/admin"
import { defineEvent, domain, EkairosRuntime } from "@ekairos/domain"
import {
  ContextHandle,
  Part,
  contextDomain,
  createReactionStreamChunk,
  encodeReactionStreamChunk,
  type ReactionStreamChunk,
} from "@ekairos/events"
import { i } from "@instantdb/core"
import type {
  ReactionEngine,
  ReactionEngineActions,
  ReactionEngineInput,
  ReactionEngineResult,
  ReactionEngineStream,
} from "@ekairos/reactor"
import { z } from "zod"

export const partStreamBenchmarkConfigSchema = z.object({
  mode: z.enum(["shared", "per-part"]),
  parts: z.number().int().min(1).max(5_000),
  chunksPerPart: z.number().int().min(1).max(10_000),
  chunkBytes: z.number().int().min(1).max(64_000),
})

export type PartStreamBenchmarkConfig = z.infer<typeof partStreamBenchmarkConfigSchema>

const benchmarkRequested = defineEvent({ payload: partStreamBenchmarkConfigSchema })
const benchmarkCompleted = defineEvent({ payload: z.record(z.string(), z.unknown()) })

export const partStreamBenchmarkDomain = domain("partStreamBenchmark")
  .includes(contextDomain)
  .withSchema({
    entities: {
      context_parts: i.entity({
        key: i.string().unique().indexed(),
        index: i.number().indexed(),
        status: i.string().indexed(),
        startedAt: i.date().indexed(),
        finishedAt: i.date().optional().indexed(),
        error: i.any().optional(),
      }),
    },
    links: {
      contextPartEvent: {
        forward: { on: "context_parts", has: "one", label: "event" },
        reverse: { on: "context_events", has: "many", label: "parts" },
      },
      contextPartStream: {
        forward: { on: "context_parts", has: "one", label: "stream" },
        reverse: { on: "$streams", has: "many", label: "parts" },
      },
    },
    rooms: {},
  })
  .withEvents({ benchmarkRequested, benchmarkCompleted })

type RuntimeEnv = Readonly<{ appId: string; adminToken: string }>

export class PartStreamBenchmarkRuntime extends EkairosRuntime<
  RuntimeEnv,
  typeof partStreamBenchmarkDomain,
  ReturnType<typeof init>
> {
  protected getDomain() {
    return partStreamBenchmarkDomain
  }

  protected async resolveDb(env: RuntimeEnv) {
    return init({
      ...env,
      schema: partStreamBenchmarkDomain.instantSchema(),
      useDateObjects: true,
    } as never)
  }
}

class ScriptedPartEngine implements ReactionEngine {
  constructor(
    private readonly chunksPerPart: number,
    private readonly chunk: string,
  ) {}

  async agent<TOutput, TActions extends ReactionEngineActions>(
    input: ReactionEngineInput<unknown, TOutput, TActions>,
  ): Promise<ReactionEngineResult<TOutput>> {
    for (let index = 0; index < this.chunksPerPart; index += 1) {
      await input.stream?.emit({
        kind: "text.delta",
        round: 0,
        partId: `text:${index}`,
        delta: this.chunk,
      })
    }
    const output = this.chunk.repeat(this.chunksPerPart)
    return {
      output: output as TOutput,
      parts: [Part.message(output)],
      metadata: { engine: "scripted-part-stream-benchmark" },
    }
  }
}

type OpenStream = Readonly<{
  streamId: string
  clientId: string
  writer: WritableStreamDefaultWriter<string>
}>

type PartTiming = Readonly<{
  streamCreateMs: number
  partOpenMs: number
  writeMs: number
  streamCloseMs: number
  stateCompleteMs: number
  totalMs: number
}>

function roundMs(value: number) {
  return Math.round(value * 100) / 100
}

function elapsed(startedAt: number) {
  return roundMs(performance.now() - startedAt)
}

function percentile(values: readonly number[], ratio: number) {
  if (values.length === 0) return 0
  const ordered = [...values].sort((left, right) => left - right)
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)
  return roundMs(ordered[index]!)
}

function summarize(timings: readonly PartTiming[]) {
  const field = (name: keyof PartTiming) => timings.map(timing => timing[name])
  return Object.freeze({
    count: timings.length,
    totalMs: roundMs(timings.reduce((sum, timing) => sum + timing.totalMs, 0)),
    p50Ms: percentile(field("totalMs"), 0.5),
    p95Ms: percentile(field("totalMs"), 0.95),
    phases: Object.freeze(Object.fromEntries(
      ([
        "streamCreateMs",
        "partOpenMs",
        "writeMs",
        "streamCloseMs",
        "stateCompleteMs",
      ] as const)
        .map(name => [name, {
          totalMs: roundMs(field(name).reduce((sum, value) => sum + value, 0)),
          p50Ms: percentile(field(name), 0.5),
          p95Ms: percentile(field(name), 0.95),
        }]),
    )),
  })
}

async function openStream(db: any, clientId: string): Promise<OpenStream> {
  const writable = db.streams.createWriteStream({
    clientId,
  }) as WritableStream<string> & { streamId(): Promise<string> }
  const streamId = await writable.streamId()
  return Object.freeze({
    streamId,
    clientId,
    writer: writable.getWriter(),
  })
}

async function closeStream(stream: OpenStream) {
  await stream.writer.close()
  stream.writer.releaseLock()
}

async function readPersistedRun(db: any, triggerId: string) {
  const persisted: any = await db.query({
    context_events: {
      $: { where: { id: triggerId }, limit: 1 },
      parts: { stream: {} },
    },
  })
  const rows = persisted.context_events?.[0]?.parts ?? []
  const streams = rows
    .map((row: any) => Array.isArray(row.stream) ? row.stream[0] : row.stream)
    .filter(Boolean)
  return {
    rows,
    streams: new Map(streams.map((stream: any) => [stream.id, stream])),
  }
}

async function observeStreamDurability(input: {
  db: any
  triggerId: string
  expectedStreams: number
  timeoutMs?: number
}) {
  const startedAt = performance.now()
  const timeoutMs = input.timeoutMs ?? 30_000
  let attempts = 0
  let persisted = await readPersistedRun(input.db, input.triggerId)
  const initiallyDoneStreams = [...persisted.streams.values()]
    .filter((stream: any) => stream.done === true).length

  while (
    [...persisted.streams.values()].filter((stream: any) => stream.done === true).length
      < input.expectedStreams
    && performance.now() - startedAt < timeoutMs
  ) {
    attempts += 1
    await new Promise(resolve => setTimeout(resolve, 25))
    persisted = await readPersistedRun(input.db, input.triggerId)
  }

  const doneStreams = [...persisted.streams.values()]
    .filter((stream: any) => stream.done === true).length
  return {
    ...persisted,
    observation: Object.freeze({
      initiallyDoneStreams,
      doneStreams,
      expectedStreams: input.expectedStreams,
      allDone: doneStreams === input.expectedStreams,
      waitMs: elapsed(startedAt),
      attempts,
    }),
  }
}

function engineStream(input: {
  reactionId: string
  eventId: string
  stream: OpenStream
}): ReactionEngineStream {
  let sequence = Date.now() * 1_000
  return Object.freeze({
    reactionId: input.reactionId,
    streamId: input.stream.streamId,
    clientId: input.stream.clientId,
    async emit(emission) {
      sequence += 1
      const chunk = createReactionStreamChunk({
        ...emission,
        reactionId: input.reactionId,
        eventId: input.eventId,
        sequence,
      })
      await input.stream.writer.write(encodeReactionStreamChunk(chunk))
      return chunk as ReactionStreamChunk
    },
  })
}

function engineInput(input: {
  runtime: PartStreamBenchmarkRuntime
  contextId: string
  contextKey: string
  event: any
  reactionId: string
  stream: ReactionEngineStream
}): ReactionEngineInput {
  return Object.freeze({
    reactionKey: "part-stream-benchmark",
    runtime: input.runtime,
    context: { ref: { id: input.contextId, key: input.contextKey }, content: {} },
    trigger: input.event,
    sessionId: `benchmark:${input.event.id}`,
    reactionId: input.reactionId,
    causeIds: [input.event.id],
    events: [input.event],
    messages: [],
    instruction: "Emit deterministic scripted chunks.",
    actions: {},
    stream: input.stream,
  })
}

export async function runPartStreamBenchmark(input: {
  runtime: PartStreamBenchmarkRuntime
  contextKey: string
  config: PartStreamBenchmarkConfig
}) {
  const config = partStreamBenchmarkConfigSchema.parse(input.config)
  const context = await ContextHandle.open(input.runtime, { key: input.contextKey, content: {} })
  const trigger = await context.append(partStreamBenchmarkDomain.events.benchmarkRequested(config))
  const db: any = await input.runtime.db()
  const runId = trigger.id
  const reactionId = `benchmark:${runId}`
  const engine = new ScriptedPartEngine(config.chunksPerPart, "x".repeat(config.chunkBytes))
  const timings: PartTiming[] = []
  const totalStartedAt = performance.now()
  const sharedStreamCreateStartedAt = performance.now()
  const sharedStream = config.mode === "shared"
    ? await openStream(db, `context-part-benchmark:${runId}:shared`)
    : undefined
  const sharedStreamCreateMs = sharedStream ? elapsed(sharedStreamCreateStartedAt) : 0

  for (let index = 0; index < config.parts; index += 1) {
    const partStartedAt = performance.now()
    const partId = globalThis.crypto.randomUUID()
    const key = `${runId}:${index}`

    let phaseStartedAt = performance.now()
    const stream = sharedStream ?? await openStream(
      db,
      `context-part-benchmark:${runId}:${index}`,
    )
    const streamCreateMs = sharedStream ? 0 : elapsed(phaseStartedAt)

    phaseStartedAt = performance.now()
    await db.transact([
      db.tx.context_parts[partId]
        .create({ key, index, status: "running", startedAt: new Date() })
        .link({ event: trigger.id, stream: stream.streamId }),
    ])
    const partOpenMs = elapsed(phaseStartedAt)

    phaseStartedAt = performance.now()
    try {
      await engine.agent(engineInput({
        runtime: input.runtime,
        contextId: context.id,
        contextKey: input.contextKey,
        event: trigger,
        reactionId,
        stream: engineStream({ reactionId, eventId: partId, stream }),
      }))
    } catch (error) {
      await db.transact([
        db.tx.context_parts[partId].update({
          status: "failed",
          finishedAt: new Date(),
          error: { message: error instanceof Error ? error.message : String(error) },
        }),
      ])
      throw error
    }
    const writeMs = elapsed(phaseStartedAt)

    phaseStartedAt = performance.now()
    await db.transact([
      db.tx.context_parts[partId].update({
        status: "completed",
        finishedAt: new Date(),
      }),
    ])
    const stateCompleteMs = elapsed(phaseStartedAt)

    phaseStartedAt = performance.now()
    if (!sharedStream) await closeStream(stream)
    const streamCloseMs = elapsed(phaseStartedAt)

    timings.push(Object.freeze({
      streamCreateMs,
      partOpenMs,
      writeMs,
      streamCloseMs,
      stateCompleteMs,
      totalMs: elapsed(partStartedAt),
    }))
  }

  const sharedStreamCloseStartedAt = performance.now()
  if (sharedStream) await closeStream(sharedStream)
  const sharedStreamCloseMs = elapsed(sharedStreamCloseStartedAt)
  const totalMs = elapsed(totalStartedAt)

  const expectedStreams = config.mode === "shared" ? 1 : config.parts
  const persisted = await observeStreamDurability({
    db,
    triggerId: trigger.id,
    expectedStreams,
  })
  const rows = persisted.rows
  const uniqueStreams = persisted.streams
  const report = Object.freeze({
    runId,
    contextId: context.id,
    config,
    totalMs,
    sharedStreamCreateMs,
    sharedStreamCloseMs,
    throughputPartsPerSecond: roundMs(config.parts / Math.max(totalMs / 1_000, 0.001)),
    timings: summarize(timings),
    durabilityObservation: persisted.observation,
    verification: Object.freeze({
      parts: rows.length,
      completedParts: rows.filter((row: any) => row.status === "completed").length,
      streams: uniqueStreams.size,
      doneStreams: [...uniqueStreams.values()].filter((stream: any) => stream.done === true).length,
      totalStreamBytes: [...uniqueStreams.values()]
        .reduce((sum: number, stream: any) => sum + Number(stream.size ?? 0), 0),
    }),
  })

  return await context.append(partStreamBenchmarkDomain.events.benchmarkCompleted(report))
}

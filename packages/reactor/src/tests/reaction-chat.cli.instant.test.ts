/* @vitest-environment node */

import { resolve } from "node:path"

import { init } from "@instantdb/admin"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createTestApp, destroyTestApp } from "@ekairos/testing/provision"
import { reactionChatDomain } from "../../examples/reaction-chat.domain.ts"
import {
  completeReactionTurn,
  executeReactionTurn,
  startReactionTurn,
} from "../../../../scripts/reaction-chat/reaction-module.ts"
import {
  logSession,
  type SessionLogRecord,
} from "../../../events/src/context.session-log.ts"

const instantToken = String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
const itInstant = instantToken ? it : it.skip

describe("reaction chat real Context path", () => {
  let appId = ""
  let adminToken = ""

  beforeAll(async () => {
    const app = await createTestApp({
      name: "reaction-chat-cli",
      token: instantToken,
      schema: reactionChatDomain.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    process.env.REACTION_CHAT_INSTANT_APP_ID = appId
    process.env.REACTION_CHAT_INSTANT_ADMIN_TOKEN = adminToken
  }, 60_000)

  afterAll(async () => {
    delete process.env.REACTION_CHAT_INSTANT_APP_ID
    delete process.env.REACTION_CHAT_INSTANT_ADMIN_TOKEN
    if (appId) await destroyTestApp({ appId, token: instantToken })
  }, 60_000)

  itInstant("returns and persists the reaction effect Event", async () => {
    const result = await executeReactionTurn({
      modulePath: resolve("examples/reaction-chat.ts"),
      contextKey: "reaction-chat:integration",
      input: { text: "hola real" },
    })

    expect(result.event.type).toBe("context.action")
    expect(result.event.payload).toEqual({
      objective: "hola real",
      summary: "2 findings converge with 2 mitigated risks.",
      recommendation: "Use event-scoped durable agents with explicit fan-out and fan-in.",
      evidenceCount: 2,
      riskCount: 2,
      reportId: expect.any(String),
      status: "published",
    })

    const db = init({
      appId,
      adminToken,
      schema: reactionChatDomain.instantSchema(),
      useDateObjects: true,
    } as never)
    const persisted = await db.query({
      context_events: {
        $: { where: { id: result.event.id }, limit: 1 },
        eventParts: { $: { order: { index: "asc" } } },
      },
      reactionChatExample_report: {
        $: { where: { id: result.event.payload.reportId }, limit: 1 },
      },
    })

    expect(persisted.context_events).toHaveLength(1)
    expect(persisted.context_events[0]?.eventParts).toHaveLength(2)
    expect(persisted.reactionChatExample_report).toEqual([
      expect.objectContaining({
        id: result.event.payload.reportId,
        objective: "hola real",
        status: "published",
      }),
    ])
  })

  itInstant("prints Session entities and stream chunks before returnValue completes", async () => {
    const started = await startReactionTurn({
      modulePath: resolve("examples/reaction-chat.ts"),
      contextKey: "reaction-chat:live-log",
      input: { text: "salida en vivo" },
    })
    const db = init({
      appId,
      adminToken,
      schema: reactionChatDomain.instantSchema(),
      useDateObjects: true,
    } as never)
    const records: SessionLogRecord[] = []
    let completed = false
    let firstStream!: (record: SessionLogRecord) => void
    const firstStreamRecord = new Promise<SessionLogRecord>(resolveRecord => {
      firstStream = resolveRecord
    })
    const completion = completeReactionTurn(started).finally(() => {
      completed = true
    })
    const logging = logSession({
      db: db as any,
      sessionId: started.run.sessionId,
      write(record) {
        records.push(record)
        if (record.kind === "stream") firstStream(record)
      },
    })

    const live = await Promise.race([
      firstStreamRecord,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("live_session_stream_timeout")), 15_000)
      }),
    ])
    expect(live.kind).toBe("stream")
    expect(completed).toBe(false)

    const [result] = await Promise.all([completion, logging])
    expect(result.sessionId).toBe(started.run.sessionId)
    const streamSequences = records
      .filter((record): record is Extract<SessionLogRecord, { kind: "stream" }> =>
        record.kind === "stream")
      .map(record => record.chunk.sequence)
    expect(new Set(streamSequences).size).toBe(streamSequences.length)
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "entity", entity: "context_sessions" }),
      expect.objectContaining({ kind: "entity", entity: "context_reactions" }),
      expect.objectContaining({ kind: "entity", entity: "context_events" }),
      expect.objectContaining({ kind: "entity", entity: "context_eventParts" }),
      expect.objectContaining({ kind: "entity", entity: "$streams" }),
    ]))
  })
})

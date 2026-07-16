/* @vitest-environment node */

import { init } from "@instantdb/admin"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, it } from "vitest"
import { z } from "zod"

import { defineEvent, domain } from "../../../domain/src/index.ts"
import { Events, contextDomain } from "../index.ts"
import {
  describeInstant,
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "./_env.ts"

const queryDomain = domain("eventQueryTest")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    messageReceived: defineEvent({
      payload: z.object({ message: z.string(), sequence: z.number() }),
    }),
    historyCompacted: defineEvent({
      payload: z.object({ through: z.string(), summary: z.string() }),
    }),
  })

describeInstant("Events.query", () => {
  let appId = ""
  let db: ReturnType<typeof init>

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "events-query",
      schema: queryDomain.instantSchema(),
    })
    appId = app.appId
    db = init({ ...app, schema: queryDomain.instantSchema(), useDateObjects: true } as any)
  }, 60_000)

  afterAll(async () => destroyContextTestApp(appId), 60_000)

  itInstant("queries domain Events in explicit InstaQL order", async () => {
    const client = Events({ db })
    const first = await client.emit(
      queryDomain.events.messageReceived({ message: "first", sequence: 1 }),
      { id: randomUUID(), createdAt: "2026-01-01T10:00:00.000Z" },
    )
    const second = await client.emit(
      queryDomain.events.messageReceived({ message: "second", sequence: 2 }),
      { id: randomUUID(), createdAt: "2026-01-01T10:00:01.000Z" },
    )

    const history = await client.query({
      $: {
        where: { domain: "eventQueryTest", name: "messageReceived" },
        order: { createdAt: "asc" },
      },
    })
    expect(history.map(event => event.id)).toEqual([first.id, second.id])
    expect(history.map(event => event.payload)).toEqual([
      { message: "first", sequence: 1 },
      { message: "second", sequence: 2 },
    ])
    expect(history.every(event => event.createdAt instanceof Date)).toBe(true)
    expect(Object.isFrozen(history)).toBe(true)
  }, 60_000)

  itInstant("keeps compaction policy explicit as another Event", async () => {
    const client = Events({ db })
    const messages = await client.query({
      $: { where: { domain: "eventQueryTest", name: "messageReceived" } },
    })
    const through = messages.at(-1)!.id
    await client.emit(
      queryDomain.events.historyCompacted({ through, summary: "First checkpoint" }),
      { id: randomUUID(), channel: "system" },
    )

    const checkpoints = await client.query({
      $: { where: { domain: "eventQueryTest", name: "historyCompacted" } },
    })
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0].payload).toEqual({ through, summary: "First checkpoint" })
  }, 60_000)

  it("rejects a non-object query", async () => {
    await expect(Events({ db }).query(null as any)).rejects.toThrow(
      "events_query_requires_object",
    )
  })
})

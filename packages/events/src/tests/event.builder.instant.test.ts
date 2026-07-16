/* @vitest-environment node */

import { init, lookup } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect } from "vitest"
import { z } from "zod"
import { defineEvent, domain } from "../../../domain/src/index.ts"

import { ContextHandle, Events, Part, contextDomain } from "../index.ts"
import {
  describeInstant,
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "./_env.ts"

const testDomain = domain("eventProjectionTest")
  .includes(contextDomain)
  .withSchema({
    entities: {
      event_test_owners: i.entity({ email: i.string().unique().indexed() }),
    },
    links: {},
    rooms: {},
  })
  .withEvents({
    received: defineEvent({
      payload: z.object({ subject: z.string() }),
      links: {
        attachments: { on: "$files", has: "many" },
        owner: { on: "event_test_owners", has: "one" },
      },
    }),
  })

const attachmentsLabel = testDomain.events.received.physicalLinks.attachments.forwardLabel
const ownerLabel = testDomain.events.received.physicalLinks.owner.forwardLabel

describeInstant("Event persistence", () => {
  let appId = ""
  let db: ReturnType<typeof init>

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "events-domain-event",
      schema: testDomain.instantSchema(),
    })
    appId = app.appId
    db = init({ ...app, schema: testDomain.instantSchema(), useDateObjects: true } as any)
  }, 60_000)

  afterAll(async () => destroyContextTestApp(appId), 60_000)

  itInstant("persists payload, physical links, Context, and eventParts", async () => {
    const ownerId = randomUUID()
    await db.transact([
      db.tx.event_test_owners[ownerId].create({ email: "owner@example.test" }),
    ])
    const upload = await db.storage.uploadFile(
      `/events/${randomUUID()}-source.txt`,
      Buffer.from("source"),
      { contentType: "text/plain" },
    )
    const fileId = (upload as any).data.id as string
    const context = await ContextHandle.create({ db }, {
      key: `event-test:${randomUUID()}`,
      content: { purpose: "projection" },
    })
    const event = await Events({ db }).emit(
      testDomain.events.received({ subject: "Files" }).link({
        attachments: [fileId],
        owner: lookup("email", "owner@example.test") as unknown as string,
      }),
      {
        id: randomUUID(),
        channel: "email",
        contextId: context.id,
        parts: [Part.message("Inspect the attachment")],
      },
    )

    const result = await db.query({
      context_events: {
        $: { where: { id: event.id }, limit: 1 },
        context: {},
        eventParts: {},
        [attachmentsLabel]: {},
        [ownerLabel]: {},
      },
    } as any)
    const row = result.context_events[0]
    expect(row).toMatchObject({
      type: "eventProjectionTest.received",
      payload: { subject: "Files" },
    })
    expect(row.context.id).toBe(context.id)
    expect(row[attachmentsLabel].map((file: any) => file.id)).toEqual([fileId])
    expect(row[ownerLabel].id).toBe(ownerId)
    expect(row.eventParts[0]).toMatchObject({
      index: 0,
      type: "message",
      content: { text: "Inspect the attachment" },
    })
  }, 60_000)

  itInstant("accepts only an identical retry for a stable Event id", async () => {
    const ownerId = randomUUID()
    await db.transact([
      db.tx.event_test_owners[ownerId].create({ email: `${ownerId}@example.test` }),
    ])
    const id = randomUUID()
    const createdAt = new Date("2026-07-14T12:00:00.000Z")
    const draft = testDomain.events.received({ subject: "Immutable" }).link({
      attachments: [],
      owner: ownerId,
    })
    const envelope = { id, channel: "test", createdAt }
    const first = await Events({ db }).emit(draft, envelope)
    expect(await Events({ db }).emit(draft, envelope)).toEqual(first)

    await expect(Events({ db }).emit(
      testDomain.events.received({ subject: "Changed" }).link({
        attachments: [],
        owner: ownerId,
      }),
      envelope,
    )).rejects.toThrow(`context_event_conflict:${id}`)
  }, 60_000)
})

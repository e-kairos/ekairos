/* @vitest-environment node */

import { afterAll, beforeAll, expect } from "vitest"
import { init } from "@instantdb/admin"
import { randomUUID } from "node:crypto"

import {
  Events,
  Part,
  contextDomain,
} from "../index.ts"
import { InstantStore } from "../stores/instant.store.ts"
import {
  describeInstant,
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "./_env.ts"
import { EventsTestRuntime } from "./context.test-runtime.ts"

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value as Record<string, unknown>[] : []
}

describeInstant("Events builder", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "events-builder",
      schema: contextDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({
      appId,
      adminToken,
      schema: contextDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }, 60_000)

  afterAll(async () => {
    await destroyContextTestApp(appId)
  }, 60_000)

  itInstant("creates an event with inline parts without creating reaction rows", async () => {
    const runtime = new EventsTestRuntime({ appId, adminToken })
    const event = await Events(runtime)
      .builder({
        id: randomUUID(),
        type: "input",
        channel: "web",
      })
      .simple(
        Part.message("Generate a dataset for this file."),
        Part.file({
          fileId: "test-file-id",
          filename: "items.csv",
          mediaType: "text/csv",
        }),
      )
      .create()

    expect(event.content.parts).toHaveLength(2)

    const snapshot = await db.query({
      event_items: {
        $: { where: { id: event.id as any }, limit: 1 },
      },
      event_steps: {
        $: { limit: 10 },
      },
    } as any)

    const row = asRows((snapshot as any).event_items)[0]
    const parts = asRows(asRecord(row?.content).parts)
    expect(parts).toHaveLength(2)
    expect(parts[0]?.type).toBe("message")
    expect(asRecord(parts[0]?.content).text).toBe(
      "Generate a dataset for this file.",
    )
    expect(parts[1]?.type).toBe("message")
    const fileBlocks = asRows(asRecord(parts[1]?.content).blocks)
    expect(fileBlocks[0]?.type).toBe("file")
    expect(fileBlocks[0]?.fileId).toBe("test-file-id")
    expect(asRows((snapshot as any).event_steps)).toHaveLength(0)

    const messages = await new InstantStore(db).itemsToModelMessages([event])
    expect(JSON.stringify(messages)).toContain("Generate a dataset for this file.")
    expect(JSON.stringify(messages)).toContain("test-file-id")
  }, 60_000)

  itInstant("supports explicit step and part chaining", async () => {
    const runtime = new EventsTestRuntime({ appId, adminToken })
    const event = await Events(runtime)
      .builder({
        id: randomUUID(),
        type: "input",
        channel: "email",
      })
      .step({ iteration: 10 })
      .part(Part.message("First step"))
      .part(Part.json({ accepted: true }))
      .step({ iteration: 20 })
      .part(Part.message("Second step"))
      .create()

    const snapshot = await db.query({
      event_items: {
        $: { where: { id: event.id as any }, limit: 1 },
      },
    } as any)

    const row = asRows((snapshot as any).event_items)[0]
    const parts = asRows(asRecord(row?.content).parts)
    expect(parts).toHaveLength(3)
    expect(asRecord(parts[0]?.content).text).toBe("First step")
    expect(asRows(asRecord(parts[1]?.content).blocks)[0]).toMatchObject({
      type: "json",
      value: { accepted: true },
    })
    expect(asRecord(parts[2]?.content).text).toBe("Second step")
  }, 60_000)
})

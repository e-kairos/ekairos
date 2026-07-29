/* @vitest-environment node */

import { randomUUID } from "node:crypto"

import { init } from "@instantdb/admin"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { z } from "zod"

import { EkairosRuntime, defineEvent, domain } from "@ekairos/domain"
import { ContextHandle, Events, contextDomain } from "@ekairos/events"
import {
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import { defineReaction, executeReaction } from "../reaction.ts"
import { ai } from "../reactor.ts"

const MODEL = "anthropic/claude-haiku-4.5"
const HIDDEN_VALUE = "ROW-20-VERIFIED-7QX"

const groundingDomain = domain("datasetGrounding")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    requested: defineEvent({ payload: z.object({ question: z.string() }) }),
  })

class GroundingRuntime extends EkairosRuntime<
  { appId: string; adminToken: string },
  typeof groundingDomain,
  ReturnType<typeof init>
> {
  readonly datasets = new Map<string, readonly unknown[]>()
  readonly reads: Array<{ datasetId: string; cursor: number; limit: number }> = []

  protected getDomain() { return groundingDomain }

  protected async resolveDb(env: { appId: string; adminToken: string }) {
    return init({
      ...env,
      schema: groundingDomain.instantSchema(),
      useDateObjects: true,
    } as any)
  }

  materializeDataset = async (input: any) => {
    const datasetId = String(input.spec.datasetId)
    if ("open" in input.spec) {
      const rows = this.datasets.get(datasetId)
      if (!rows) throw new Error(`grounding_dataset_missing:${datasetId}`)
      return this.result(datasetId, rows, "opened")
    }

    const rows = Array.from({ length: 25 }, (_, index) => ({
      index,
      observedValue: index === 20 ? HIDDEN_VALUE : `row-${index}`,
      observedAt: `2026-07-29T${String(index).padStart(2, "0")}:00:00Z`,
    }))
    this.datasets.set(datasetId, rows)
    return this.result(datasetId, rows, "built")
  }

  private result(
    datasetId: string,
    rows: readonly unknown[],
    mode: "opened" | "built",
  ) {
    return {
      datasetId,
      mode,
      previewRows: rows.slice(0, 3),
      count: rows.length,
      reader: {
        read: async (params: { cursor?: number; limit?: number } = {}) => {
          const cursor = params.cursor ?? 0
          const limit = params.limit ?? 50
          this.reads.push({ datasetId, cursor, limit })
          const page = rows.slice(cursor, cursor + limit)
          return {
            rows: [...page],
            cursor: cursor + page.length,
            done: cursor + page.length >= rows.length,
          }
        },
      },
    }
  }
}

describe("live Dataset grounding beyond preview", () => {
  let appId = ""
  let adminToken = ""

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "reaction-dataset-grounding",
      schema: groundingDomain.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
  }, 120_000)

  afterAll(async () => {
    await destroyContextTestApp(appId)
  }, 60_000)

  itInstant("answers from row 20 only after a durable dataset.read action", async () => {
    const runtime = new GroundingRuntime({ appId, adminToken })
    const context = await ContextHandle.create(runtime, {
      key: `dataset-grounding:${randomUUID()}`,
      content: { purpose: "prove row-level grounding beyond preview" },
    })
    const trigger = await Events(runtime).emit(
      groundingDomain.events.requested({
        question: "What exact observedValue is stored at index 20?",
      }),
      { contextId: context.id, channel: "test" },
    )
    const definition = defineReaction(
      groundingDomain.events.requested,
      {
        key: "datasetGrounding.answer",
        scope: groundingDomain,
        engine: ai({ model: MODEL }),
        sandbox: false,
      },
      async reaction => {
        const dataset = await reaction.given(reaction.trigger).dataset({
          instruction: "Materialize the 25 ordered observations exactly.",
          schema: z.object({
            index: z.number().int(),
            observedValue: z.string(),
            observedAt: z.string(),
          }),
        })
        return await reaction.given([reaction.trigger, dataset]).agent({
          instruction: [
            "Answer the requested observedValue at index 20.",
            "The preview contains only rows 0-2, so the answer is impossible from preview.",
            "You must call dataset.read and ground the answer in the returned row.",
          ].join(" "),
          output: z.object({
            value: z.string(),
            evidenceIndex: z.literal(20),
          }),
          datasets: true,
        })
      },
    )

    const answer = await executeReaction(runtime, context, trigger, definition)
    expect((answer.payload as any).value).toContain(HIDDEN_VALUE)
    expect(runtime.reads.length).toBeGreaterThanOrEqual(1)

    const db = init({
      appId,
      adminToken,
      schema: groundingDomain.instantSchema(),
      useDateObjects: true,
    } as any)
    const graph = await db.query({
      context_sessions: {
        $: { where: { context: context.id } },
        reactions: {
          effects: {
            eventParts: { $: { order: { index: "asc" } } },
          },
        },
      },
    } as any)
    const sessions = (graph as any).context_sessions ?? []
    const readParts = sessions
      .flatMap((session: any) => session.reactions ?? [])
      .flatMap((reaction: any) => reaction.effects ?? [])
      .flatMap((event: any) => event.eventParts ?? [])
      .map((part: any) => part.content)
      .filter((content: any) =>
        content?.actionName === "dataset.read" &&
        content?.status === "completed")

    console.log("[DATASET GROUNDING] answer:", JSON.stringify(answer.payload))
    console.log("[DATASET GROUNDING] reads:", JSON.stringify(runtime.reads))
    console.log("[DATASET GROUNDING] graph read parts:", readParts.length)
    expect(readParts.length).toBeGreaterThanOrEqual(1)
  }, 300_000)
})

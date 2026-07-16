/* @vitest-environment node */

import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"
import { z } from "zod"

import {
  defineDomainAction,
  domain,
  EkairosRuntime,
} from "@ekairos/domain"
import { Context, Events, contextDomain, defineEvent } from "@ekairos/context"
import { ai, defineReaction } from "@ekairos/reactor"

import {
  destroyDocumentsTestApp,
  hasInstantProvisionToken,
  provisionDocumentsTestApp,
} from "./_env.ts"
import { documentDomain } from "../schema.ts"
import { documentActions } from "../actions.ts"

const REAL_MODEL = String(
  process.env.DOCUMENTS_REACTION_MODEL ?? "openai/gpt-5.4-nano",
).trim()
const hasAiGatewayApiKey = Boolean(
  String(process.env.AI_GATEWAY_API_KEY ?? "").trim(),
)
const hasRealReactionEnv = hasInstantProvisionToken() && hasAiGatewayApiKey

const describeReaction = hasRealReactionEnv ? describe : describe.skip
const itReaction = hasRealReactionEnv ? it : it.skip

let documentReads = 0

const reactionOutputSchema = z.object({
  itemsCount: z.number(),
  mostExpensive: z.string(),
})

const documentReadResultSchema = z.object({
  documentId: z.string(),
  fileId: z.string(),
  name: z.string().optional(),
  status: z.string(),
  pagesCount: z.number(),
  content: z.string(),
  truncated: z.boolean(),
})

const testDomain = domain("documentsReactionTest")
  .includes(contextDomain)
  .includes(documentDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    requested: defineEvent({
      payload: z.object({ fileId: z.string() }),
    }),
    completed: defineEvent({ payload: reactionOutputSchema }),
  })
  .withActions({
    readDocument: defineDomainAction({
      description: "Read and formalize the attached procurement document.",
      input: z.object({ fileId: z.string() }),
      output: documentReadResultSchema,
      async execute({ runtime, input }) {
        documentReads += 1
        const result = await documentActions(runtime as any)
          .document_read.execute({ fileId: input.fileId })
        return documentReadResultSchema.parse(result)
      },
    }),
  })

type ReactionTestEnv = { appId: string; adminToken: string }

class DocsReactionRuntime extends EkairosRuntime<
  ReactionTestEnv,
  typeof testDomain,
  ReturnType<typeof init>
> {
  protected getDomain() {
    return testDomain
  }

  protected async resolveDb(env: ReactionTestEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: testDomain.instantSchema(),
      useDateObjects: true,
    } as any)
  }
}

const CSV_FIXTURE = [
  "item,cantidad,precio_unitario",
  "Bomba centrifuga 5HP,4,1250",
  "Valvula esclusa 2in,10,85",
  "Motor electrico 10HP,2,3100",
].join("\n")

describeReaction("@ekairos/documents in a real reaction", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>

  beforeAll(async () => {
    const app = await provisionDocumentsTestApp({
      name: `documents-reaction-${Date.now()}`,
      schema: testDomain.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({ appId, adminToken })
  }, 5 * 60 * 1000)

  afterAll(async () => {
    if (process.env.APP_TEST_PERSIST !== "true") {
      await destroyDocumentsTestApp(appId)
    } else {
      console.log(`[documents.reaction] persisted app: appId=${appId} adminToken=${adminToken}`)
    }
  })

  itReaction(
    "model reads an attached file through document_read and answers from it",
    async () => {
      const runtime = new DocsReactionRuntime({ appId, adminToken })
      documentReads = 0

      const uploadResult = await db.storage.uploadFile(
        `/tests/reaction/${Date.now()}-${randomUUID().slice(0, 8)}-items.csv`,
        Buffer.from(CSV_FIXTURE, "utf8"),
        { contentType: "text/csv", contentDisposition: "items.csv" },
      )
      const fileId = (uploadResult as any)?.data?.id as string
      expect(fileId).toBeTruthy()

      const contextKey = `documents-reaction:${Date.now()}`
      const context = await Context(runtime).create({
        key: contextKey,
        content: {},
      })
      const triggerEvent = await Events(runtime).emit(
        testDomain.events.requested({ fileId }),
        {
          id: randomUUID(),
          channel: "web",
          contextId: context.id,
          createdAt: new Date(),
        },
      )
      const definition = defineReaction(
        testDomain.events.requested,
        {
          key: "documents.reaction.test",
          scope: testDomain,
          engine: ai({ model: REAL_MODEL, maxRounds: 8 }),
          sandbox: false,
        },
        async reaction => {
          const reply = await reaction.given(reaction.trigger).agent({
            instruction:
              `Read the procurement CSV attached as file "${reaction.trigger.payload.fileId}" ` +
              `with the available document action. Then report itemsCount (the number of ` +
              `line items, excluding the header) and mostExpensive (the exact item name ` +
              `with the highest precio_unitario).`,
            actions: [testDomain.actions.readDocument],
            output: reactionOutputSchema,
          })
          return await reaction.given(reply).emit(
            testDomain.events.completed(reply.payload),
          )
        },
      )

      const effect = await context.react(triggerEvent, definition)
      if (process.env.APP_TEST_PERSIST === "true") {
        console.log(
          `[documents.reaction] contextId=${context.id} contextKey=${contextKey}`,
        )
      }

      // The model actually consulted the document.
      expect(documentReads).toBeGreaterThanOrEqual(1)

      // And answered from its content.
      const output = effect.payload
      expect(output.itemsCount).toBe(3)
      expect(output.mostExpensive.toLowerCase()).toContain("motor")

      // The file was formalized exactly once, inline (csv), and persisted.
      const docSnapshot = await db.query({
        document_documents: {
          $: { where: { "file.id": fileId } },
          pages: {},
        },
      } as any)
      const docs = (docSnapshot as any).document_documents ?? []
      expect(docs.length).toBe(1)
      expect(docs[0].status).toBe("ready")
      expect(docs[0].provider).toBe("inline")

      // The reaction is fully persisted as Session, Reactions, Events, and Parts.
      const contextSnapshot = await db.query({
        context_contexts: {
          $: { where: { key: contextKey }, limit: 1 },
          sessions: {
            trigger: {},
            rootReaction: { effects: {} },
            reactions: {
              $: { order: { position: "asc" } },
              causes: {},
              effects: { eventParts: { $: { order: { index: "asc" } } } },
            },
          },
        },
      } as any)
      const contexts = (contextSnapshot as any).context_contexts ?? []
      expect(contexts.length).toBe(1)
      const sessions = contexts[0].sessions ?? []
      expect(sessions).toHaveLength(1)
      expect(sessions[0].status).toBe("completed")
      const rootReaction = Array.isArray(sessions[0].rootReaction)
        ? sessions[0].rootReaction[0]
        : sessions[0].rootReaction
      expect(rootReaction.effects.map((event: any) => event.id))
        .toContain(effect.id)

      const agentReaction = sessions[0].reactions.find(
        (reaction: any) => reaction.type === "agent",
      )
      expect(agentReaction?.status).toBe("completed")
      expect(agentReaction?.causes.map((event: any) => event.id)).toEqual([triggerEvent.id])
      expect(agentReaction?.effects[0].payload).toEqual(output)
      const actionParts = agentReaction.effects[0].eventParts
        .filter((part: any) => part.type === "action")
        .map((part: any) => part.content)
      expect(actionParts.some((part: any) => (
        part.status === "completed" && String(part.actionName).includes("readDocument")
      ))).toBe(true)
    },
    8 * 60 * 1000,
  )
})

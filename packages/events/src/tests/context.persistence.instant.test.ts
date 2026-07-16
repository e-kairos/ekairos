/* @vitest-environment node */

import { init } from "@instantdb/admin"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect } from "vitest"
import { z } from "zod"

import { defineEvent, domain } from "../../../domain/src/index.ts"
import { ContextHandle, Events, Part } from "../index.ts"
import { contextDomain } from "../schema.ts"
import { InstantStore } from "../stores/instant.store.ts"
import {
  describeInstant,
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "./_env.ts"

const testDomain = domain("contextPersistenceTest")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    messageReceived: defineEvent({
      payload: z.object({ message: z.string() }),
    }),
    messageAnswered: defineEvent({
      payload: z.object({ message: z.string() }),
    }),
  })

describeInstant("context causal persistence", () => {
  let appId = ""
  let db: ReturnType<typeof init>

  beforeAll(async () => {
    const schema = testDomain.toInstantSchema()
    const app = await provisionContextTestApp({
      name: `context-causal-persistence-${Date.now()}`,
      schema,
    })
    appId = app.appId
    db = init({
      appId,
      adminToken: app.adminToken,
      schema,
      useDateObjects: true,
    } as any)
  })

  afterAll(async () => {
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyContextTestApp(appId)
    }
  })

  itInstant("persists Context, Session, Event, Reaction, and eventParts as one causal graph", async () => {
    const runtime = { db }
    const events = Events(runtime)
    const store = new InstantStore(db)
    const firstContext = await ContextHandle.create(runtime, {
      id: randomUUID(),
      content: { policy: "strict" },
    })
    const updatedContext = await firstContext.updateContent({ policy: "reviewed" })
    expect(updatedContext.context.previous).toEqual({ policy: "strict" })

    const triggerId = randomUUID()
    const trigger = await events.emit(
      testDomain.events.messageReceived({ message: "Cotiza los adjuntos." }),
      {
        id: triggerId,
        channel: "web",
        contextId: updatedContext.id,
        parts: [Part.message("Cotiza los adjuntos.")],
      },
    )
    expect(trigger.type).toBe("contextPersistenceTest.messageReceived")
    expect(trigger.eventParts).toHaveLength(1)

    const sessionId = randomUUID()
    const rootReactionId = randomUUID()
    const session = await updatedContext.openSession({
      id: sessionId,
      rootReactionId,
      definition: "contextPersistenceTest.answerMessage",
      triggerId,
    })
    expect(session).toMatchObject({ status: "running", triggerId, rootReactionId })

    const operationReactionId = randomUUID()
    await updatedContext.openReaction({
      id: operationReactionId,
      sessionId,
      parentReactionId: rootReactionId,
      type: "context.agent",
      position: 1,
      depth: 1,
      causeIds: [triggerId],
      instruction: "Responde el mensaje.",
    })
    const agentResult = await events.create({
      id: randomUUID(),
      type: "context.agent",
      contextId: updatedContext.id,
      payload: { message: "Oferta preparada." },
      parts: [Part.message("Oferta preparada.")],
    })
    await store.completeReaction(operationReactionId, "completed", [agentResult.id])

    const answer = await events.emit(
      testDomain.events.messageAnswered({ message: agentResult.payload.message }),
      { id: randomUUID(), channel: "web", contextId: updatedContext.id },
    )
    await store.completeReaction(rootReactionId, "completed", [answer.id])
    await store.completeSession(sessionId, "completed")

    const graph = await db.query({
      context_sessions: {
        $: { where: { id: sessionId }, limit: 1 },
        context: {},
        trigger: { eventParts: {} },
        rootReaction: {
          causes: {},
          effects: {},
          children: { causes: {}, effects: { eventParts: {} } },
        },
      },
    } as any)
    const stored = graph.context_sessions[0]
    expect(stored.status).toBe("completed")
    expect(stored.trigger.id).toBe(triggerId)
    expect(stored.rootReaction.causes.map((event: any) => event.id)).toEqual([triggerId])
    expect(stored.rootReaction.effects.map((event: any) => event.id)).toEqual([answer.id])
    expect(stored.rootReaction.children[0].effects[0].id).toBe(agentResult.id)

    const secondContext = await ContextHandle.create(runtime, {
      id: randomUUID(),
      content: { policy: "independent" },
    })
    const secondSession = await secondContext.openSession({
      id: randomUUID(),
      rootReactionId: randomUUID(),
      definition: "contextPersistenceTest.independentAnswer",
      triggerId,
    })
    expect(secondSession.contextId).toBe(secondContext.id)
    expect(secondSession.triggerId).toBe(triggerId)

    const retried = await events.emit(
      testDomain.events.messageReceived({ message: "Cotiza los adjuntos." }),
      {
        id: triggerId,
        channel: "web",
        contextId: updatedContext.id,
        parts: [Part.message("Cotiza los adjuntos.")],
      },
    )
    expect(retried.id).toBe(triggerId)
  }, 120_000)
})

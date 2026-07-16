/* @vitest-environment node */

import { randomUUID } from "node:crypto"

import { init } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { afterAll, beforeAll, expect } from "vitest"
import { z } from "zod"

import { defineDomainAction, domain, EkairosRuntime } from "@ekairos/domain"
import { defineReaction } from "@ekairos/reactor"
import {
  Context,
  Events,
  contextDomain,
  defineEvent,
} from "../index.js"
import {
  describeInstant,
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"

const emailDomain = domain("email")
  .includes(contextDomain)
  .withSchema({
    entities: {
      email_messages: i.entity({ subject: i.string().indexed() }),
      email_orders: i.entity({ code: i.string().indexed(), status: i.string().indexed() }),
    },
    links: {},
    rooms: {},
  })
  .withEvents({
    received: defineEvent({
      payload: z.object({ from: z.string().email(), subject: z.string() }),
      links: { message: { on: "email_messages", has: "one" } },
    }),
    extractionRequested: defineEvent({
      payload: z.object({ orderCode: z.string() }),
      links: { message: { on: "email_messages", has: "one" } },
    }),
    orderExtracted: defineEvent({
      payload: z.object({ orderCode: z.string() }),
      links: { message: { on: "email_messages", has: "one" } },
    }),
    processingCompleted: defineEvent({
      payload: z.object({ orderCode: z.string() }),
      links: { message: { on: "email_messages", has: "one" } },
    }),
  })
  .withActions({
    completeOrder: defineDomainAction({
      description: "Complete one extracted order.",
      input: z.object({ orderId: z.string().uuid(), code: z.string() }),
      output: z.object({ orderId: z.string().uuid(), code: z.string(), status: z.literal("completed") }),
      execute: async ({ input, domain: activeDomain }) => {
        const db = (activeDomain as any).db
        await db.transact([
          db.tx.email_orders[input.orderId].update({ code: input.code, status: "completed" }),
        ])
        return { ...input, status: "completed" as const }
      },
    }),
  })

const appDomain = domain("context-test-app")
  .includes(emailDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withActions(emailDomain.actions)

type Env = { appId: string; adminToken: string }

class ContextTestRuntime extends EkairosRuntime<Env, typeof appDomain, ReturnType<typeof init>> {
  protected getDomain() { return appDomain }
  protected resolveDb(env: Env) {
    return init({
      ...env,
      schema: appDomain.instantSchema(),
      useDateObjects: true,
    } as any)
  }
}

describeInstant("@ekairos/context", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "context-domain-event-reactor",
      schema: appDomain.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({ ...app, schema: appDomain.instantSchema(), useDateObjects: true } as any)
  }, 60_000)

  afterAll(async () => destroyContextTestApp(appId), 60_000)

  itInstant("creates pure Context data and reacts to a linked Event", async () => {
    const runtime = new ContextTestRuntime({ appId, adminToken })
    const messageId = randomUUID()
    const orderId = randomUUID()
    await db.transact([
      db.tx.email_messages[messageId].create({ subject: "Factura OC 4400" }),
    ])
    const created = await Context(runtime).create({
      key: `email:${messageId}`,
      content: { requisitionId: "REQ-1", version: 1 },
    })
    const context = await created.updateContent({ requisitionId: "REQ-1", version: 2 })
    expect(context.content).toEqual({ requisitionId: "REQ-1", version: 2 })
    expect(context.previous).toEqual({ requisitionId: "REQ-1", version: 1 })

    const trigger = await Events(runtime).emit(
      emailDomain.events.received({
        from: "supplier@example.com",
        subject: "Factura OC 4400",
      }).link({ message: messageId }),
      { id: randomUUID(), channel: "email", contextId: context.id },
    )
    const definition = defineReaction(
      emailDomain.events.received,
      { key: "email.complete-order", scope: emailDomain, engine: false, sandbox: false },
      async reaction => {
        expect(reaction.trigger.id).toBe(trigger.id)
        expect(reaction.context.content.version).toBe(2)
        const order = await reaction.given(reaction.trigger).action(
          emailDomain.actions.completeOrder.scope({ orderId }),
          { code: "4400" },
        )
        return await reaction.given(order).emit(
          emailDomain.events.processingCompleted({ orderCode: order.payload.code })
            .link({ message: messageId }),
        )
      },
    )

    const completed = await context.react(trigger, definition)
    expect(completed.payload).toEqual({ orderCode: "4400" })
    const graph = await db.query({
      context_sessions: {
        $: { where: { context: context.id }, limit: 1 },
        trigger: {},
        rootReaction: { effects: {} },
        reactions: { effects: { eventParts: {} } },
      },
    } as any)
    const session = graph.context_sessions[0]
    expect(session.status).toBe("completed")
    expect(session.trigger.id).toBe(trigger.id)
    expect(session.rootReaction.effects[0].id).toBe(completed.id)
    const action = session.reactions.find((row: any) => row.type === "action")
    expect([...action.effects[0].eventParts]
      .sort((left: any, right: any) => left.index - right.index)
      .map((part: any) => part.content.status))
      .toEqual(["started", "completed"])
  }, 60_000)

  itInstant("links an inline child Reaction through a child Session", async () => {
    const runtime = new ContextTestRuntime({ appId, adminToken })
    const messageId = randomUUID()
    await db.transact([
      db.tx.email_messages[messageId].create({ subject: "OC 6600" }),
    ])
    const context = await Context(runtime).create({
      key: `email:child:${messageId}`,
      content: { mailbox: "purchasing" },
    })
    const trigger = await Events(runtime).emit(
      emailDomain.events.received({ from: "supplier@example.com", subject: "OC 6600" })
        .link({ message: messageId }),
      { id: randomUUID(), contextId: context.id },
    )
    const parent = defineReaction(
      emailDomain.events.received,
      { key: "email.process", scope: emailDomain, engine: false, sandbox: false },
      async reaction => {
        const requested = await reaction.given(reaction.trigger).emit(
          emailDomain.events.extractionRequested({ orderCode: "6600" })
            .link({ message: messageId }),
        )
        const extracted = await reaction.react(
          requested,
          defineReaction(
            emailDomain.events.extractionRequested,
            { key: "email.extract", scope: emailDomain, engine: false, sandbox: false },
            async child => await child.given(child.trigger).emit(
              emailDomain.events.orderExtracted({ orderCode: child.trigger.payload.orderCode })
                .link({ message: messageId }),
            ),
          ),
        )
        return await reaction.given(extracted).emit(
          emailDomain.events.processingCompleted({ orderCode: extracted.payload.orderCode })
            .link({ message: messageId }),
        )
      },
    )

    const completed = await context.react(trigger, parent)
    expect(completed.payload.orderCode).toBe("6600")
    const graph = await db.query({
      context_sessions: {
        $: { where: { context: context.id } },
        parent: {},
        children: { parent: {}, trigger: {}, rootReaction: { effects: {} } },
        reactions: { causes: {}, effects: {} },
      },
    } as any)
    const parentSession = graph.context_sessions.find((row: any) => !row.parent)
    expect(parentSession.children).toHaveLength(1)
    expect(parentSession.children[0].parent.id).toBe(parentSession.id)
    expect(parentSession.children[0].trigger.id).toBe(
      parentSession.reactions.find((row: any) => row.type === "emit").effects[0].id,
    )
    expect(parentSession.reactions.some((row: any) => (
      row.type === "child" && row.instruction === "email.extract"
    )))
      .toBe(true)
  }, 60_000)
})

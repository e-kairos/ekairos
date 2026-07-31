/* @vitest-environment node */

import { randomUUID } from "node:crypto"

import { init } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { afterAll, beforeAll, expect } from "vitest"
import { z } from "zod"

import { defineDomainAction, domain, EkairosRuntime } from "@ekairos/domain"
import {
  Context,
  contextDomain,
  defineEvent,
} from "../index.js"
import {
  describeInstant,
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"

const emailCore = domain("email")
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
    noted: defineEvent({
      payload: z.object({ text: z.string() }),
      links: { message: { on: "email_messages", has: "one" } },
    }),
  })

const completeOrder = defineDomainAction({
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
})

const emailDomain = emailCore.withActions({ completeOrder })
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

describeInstant("@ekairos/context flat session", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "context-flat-session",
      schema: appDomain.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({ ...app, schema: appDomain.instantSchema(), useDateObjects: true } as any)
  }, 60_000)

  afterAll(async () => destroyContextTestApp(appId), 60_000)

  itInstant("opens a Context and chains exogenous append events", async () => {
    const runtime = new ContextTestRuntime({ appId, adminToken })
    const messageId = randomUUID()
    await db.transact([
      db.tx.email_messages[messageId].create({ subject: "Factura OC 4400" }),
    ])
    const context = await Context(runtime).open({
      key: `email:${messageId}`,
      content: { requisitionId: "REQ-1", version: 2 },
    })

    const received = await context.append(
      emailDomain.events.received({
        from: "supplier@example.com",
        subject: "Factura OC 4400",
      }).link({ message: messageId }),
    )
    const noted = await context.append(
      emailDomain.events.noted({ text: "manual review" }).link({ message: messageId }),
    )

    expect(context.content).toEqual({ requisitionId: "REQ-1", version: 2 })
    expect(noted.metadata.causeIds).toEqual([received.id])
    expect((await context.events).map(event => event.id)).toEqual([received.id, noted.id])
  }, 60_000)

  itInstant("runs an action from an explicit causal point and completes the Session", async () => {
    const runtime = new ContextTestRuntime({ appId, adminToken })
    const messageId = randomUUID()
    const orderId = randomUUID()
    await db.transact([
      db.tx.email_messages[messageId].create({ subject: "OC 6600" }),
    ])
    const context = await Context(runtime).open({
      key: `email:session:${messageId}`,
      content: { mailbox: "purchasing" },
    })
    const trigger = await context.append(
      emailDomain.events.received({
        from: "supplier@example.com",
        subject: "OC 6600",
      }).link({ message: messageId }),
    )
    const session = context.session({
      scope: emailDomain,
      engine: false,
      sandbox: false,
    })
    const completed = await session.from(trigger).action(
      emailDomain.actions.completeOrder.scope({ orderId }),
      { code: "6600" },
    )
    await session.complete()

    expect(completed.payload).toEqual({ orderId, code: "6600", status: "completed" })
    const graph = await db.query({
      context_sessions: {
        $: { where: { context: context.id }, limit: 1 },
        trigger: {},
        rootReaction: { effects: {} },
        reactions: { causes: {}, effects: { eventParts: {} } },
      },
    } as any)
    const stored = graph.context_sessions[0]
    expect(stored.definition).toBe("session")
    expect(stored.status).toBe("completed")
    expect(stored.trigger.id).toBe(trigger.id)
    expect(stored.rootReaction.effects[0].id).toBe(completed.id)
    expect(stored.reactions[0].causes[0].id).toBe(trigger.id)
  }, 60_000)
})

/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { init } from "@instantdb/admin"
import { randomUUID } from "node:crypto"
import { EkairosRuntime, domain, defineEvent } from "@ekairos/domain"
import { Context } from "@ekairos/context"
import { defineReaction } from "@ekairos/reactor"
import { z } from "zod"

import { createTestApp, destroyTestApp } from "../../../ekairos-test/src/provision.ts"
import { bindReaction } from "../agent.ts"
import { createChannelMessage } from "../index.ts"
import { channelDomain } from "../schema.ts"
import type { ChannelInbound } from "../platforms.ts"

import "./_env.ts"
import { hasVar } from "./_env.ts"

const describeInstant = hasVar("INSTANT_PERSONAL_ACCESS_TOKEN") ? describe : describe.skip

const testDomain = domain("channelTest")
  .includes(channelDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    messageReceived: defineEvent({
      payload: z.object({ text: z.string(), participant: z.string().optional() }),
      links: {
        message: { on: "channel_messages", has: "one" },
      },
    }),
    responseReady: defineEvent({
      payload: z.object({ text: z.string() }),
      links: {
        message: { on: "channel_messages", has: "one" },
      },
    }),
  })

type TestEnv = { appId: string; adminToken: string }

class ChannelTestRuntime extends EkairosRuntime<
  TestEnv,
  typeof testDomain,
  ReturnType<typeof init>
> {
  protected getDomain() {
    return testDomain
  }

  protected async resolveDb(env: TestEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: testDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }
}

const responseReaction = defineReaction(
  testDomain.events.messageReceived,
  {
    key: "channelTest.respond",
    scope: testDomain,
    engine: false,
    sandbox: false,
  },
  async current => await current.given(current.trigger).emit(
    testDomain.events.responseReady({ text: "Respuesta desde reaction." })
      .link({ message: current.trigger.links.message }),
  ),
)

function rows(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value as Record<string, any>[] : []
}

function inboundFixture(overrides: Partial<ChannelInbound> = {}): ChannelInbound {
  return {
    channel: "slack",
    threadKey: "slack:T123",
    contextId: "ctx_slack_123",
    message: createChannelMessage({
      channel: "slack",
      direction: "inbound",
      role: "user",
      text: "Necesito estado de la compra.",
      participant: "U123",
      contextId: "ctx_slack_123",
    }),
    reply: async () => {},
    attachEvent: async () => {},
    ...overrides,
  }
}

describe("@ekairos/channel binder errors", () => {
  it("propagates mapper rejection before persistence, attach, or react", async () => {
    const attachEvent = vi.fn()
    const handler = bindReaction({
      runtime: { db: async () => { throw new Error("db must not be called") } },
      reaction: responseReaction,
      event: async () => { throw new Error("mapper rejected") },
    } as any)

    await expect(handler(inboundFixture({ attachEvent }))).rejects.toThrow("mapper rejected")
    expect(attachEvent).not.toHaveBeenCalled()
  })

  it("propagates malformed drafts without attaching or reacting", async () => {
    const attachEvent = vi.fn()
    const malformed = () => ({ payload: {}, links: {}, physicalLinks: {} })
    const handler = bindReaction({
      runtime: { db: async () => { throw new Error("db must not be called") } },
      reaction: responseReaction,
      event: malformed as any,
    } as any)

    await expect(handler(inboundFixture({ attachEvent }))).rejects.toThrow("invalid_domain_event_domain")
    expect(attachEvent).not.toHaveBeenCalled()
  })
})

describeInstant("@ekairos/channel agent binding", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>
  let runtime: ChannelTestRuntime

  beforeAll(async () => {
    const app = await createTestApp({
      name: `channel-agent-${Date.now()}`,
      token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN),
      schema: testDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({
      appId: app.appId,
      adminToken: app.adminToken,
      schema: testDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
    runtime = new ChannelTestRuntime({ appId, adminToken })
  }, 60_000)

  afterAll(async () => {
    if (process.env.APP_TEST_PERSIST === "true") return
    await destroyTestApp({ appId, token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN) })
  }, 60_000)

  it("emits an application event and preserves its relations and provenance", async () => {
    const contextId = randomUUID()
    const message = createChannelMessage({
      channel: "slack",
      direction: "inbound",
      role: "user",
      text: "Necesito estado de la compra.",
      participant: "U123",
      contextId,
    })
    await Context(runtime).create({
      id: contextId,
      key: "slack:T123",
      content: { channel: "slack" },
    })
    await db.transact([
      db.tx.channel_messages[message.id].update({
        channel: message.channel,
        direction: message.direction,
        role: message.role,
        text: message.text,
        participant: message.participant,
        createdAt: new Date(message.createdAt),
      }).link({ context: contextId }),
    ])

    let observedEffectId = ""
    const inbound = inboundFixture({
      message,
      contextId,
      attachEvent: async (eventId) => {
        await db.transact([db.tx.channel_messages[message.id].link({ event: eventId })])
      },
    })
    const handler = bindReaction({
      runtime,
      reaction: responseReaction,
      event: (received) => testDomain.events.messageReceived({
        text: received.message.text ?? "",
        participant: received.message.participant,
      }).link({ message: received.message.id }),
      replyText: (effect) => {
        observedEffectId = effect.id
        expect(effect.payload.text).toBe("Respuesta desde reaction.")
        return effect.payload.text
      },
    })

    expect(await handler(inbound)).toBe("Respuesta desde reaction.")
    expect(observedEffectId).toBeTruthy()

    const snapshot = await db.query({
      context_events: {
        $: { where: { context: contextId as any }, limit: 10 },
        channeltest_message: {},
        context: {},
        channelMessages: {},
      },
    } as any)
    const event = rows((snapshot as any).context_events)
      .find((item) => item.name === "messageReceived")
    expect(event.payload).toEqual({ text: "Necesito estado de la compra.", participant: "U123" })
    expect(event.channeltest_message.id).toBe(message.id)
    expect(event.context.id).toBe(contextId)
    expect(rows(event.channelMessages).map((row) => row.id)).toContain(message.id)

    const effect = rows((snapshot as any).context_events)
      .find((item) => item.id === observedEffectId)
    expect(effect.payload).toEqual({ text: "Respuesta desde reaction." })
    expect(effect.channeltest_message.id).toBe(message.id)
  }, 60_000)
})

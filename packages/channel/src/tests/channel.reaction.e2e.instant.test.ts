/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"
import { z } from "zod"

import { EkairosRuntime, composeDomain, defineEvent } from "@ekairos/domain"
import { getContextRuntimeServices } from "@ekairos/events"
import { ai, defineReaction } from "@ekairos/reactor"

import "./_env.ts"
import { hasVar } from "./_env.ts"
import { channelDomain } from "../schema.ts"
import { createEmailChannel, createWhatsAppChannel, twilio } from "../native.ts"
import { bindReaction } from "../agent.ts"
import type { ChannelInbound } from "../platforms.js"

import {
  createTestApp,
  destroyTestApp,
} from "../../../ekairos-test/src/provision.ts"

const REAL_MODEL = String(process.env.CHANNEL_E2E_MODEL ?? "openai/gpt-5.4-nano").trim()
const hasFullEnv =
  hasVar("INSTANT_PERSONAL_ACCESS_TOKEN") &&
  hasVar("AI_GATEWAY_API_KEY") &&
  hasVar("RESEND_API_KEY") &&
  hasVar("ESOLBAY_EMAIL_DOMAIN")

const describeE2E = hasFullEnv ? describe : describe.skip
const itE2E = hasFullEnv ? it : it.skip

const testDomain = composeDomain("channel.e2e", [channelDomain]).withEvents({
  inboundReceived: defineEvent({
    payload: z.object({ text: z.string(), participant: z.string().optional() }),
    links: {
      message: { on: "channel_messages", has: "one" },
      files: { on: "$files", has: "many" },
    },
  }),
  replyReady: defineEvent({
    payload: z.object({ reply: z.string() }),
    links: {
      message: { on: "channel_messages", has: "one" },
    },
  }),
})

type E2EEnv = { appId: string; adminToken: string }

class ChannelE2ERuntime extends EkairosRuntime<
  E2EEnv,
  typeof testDomain,
  ReturnType<typeof init>
> {
  protected getDomain() {
    return testDomain
  }

  protected async resolveDb(env: E2EEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: testDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }
}

const OFFER_LINES = [
  "Oferta - item | cantidad | precio_unitario",
  "Bomba centrifuga 5HP | 4 | 1250",
  "Valvula esclusa 2in | 10 | 85",
  "Motor electrico 10HP | 2 | 3100",
]

function offerPdf(): Uint8Array {
  const escaped = OFFER_LINES.map((line) => line.replace(/[()\\]/g, "\\$&"))
  const stream = [
    "BT /F1 11 Tf 50 750 Td",
    ...escaped.flatMap((line, index) => index === 0 ? [`(${line}) Tj`] : [`0 -20 Td (${line}) Tj`]),
    "ET",
  ].join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

function asRows(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? (value as Record<string, any>[]) : []
}

function one(value: unknown): Record<string, any> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, any>) ?? null
  return value && typeof value === "object" ? (value as Record<string, any>) : null
}

function inboundEvent(inbound: ChannelInbound) {
  const files = (inbound.message.parts ?? []).flatMap((part) => {
    const record = part && typeof part === "object" ? part as Record<string, unknown> : {}
    return record.type === "file" && typeof record.fileId === "string" ? [record.fileId] : []
  })
  return testDomain.events.inboundReceived({
    text: inbound.message.text ?? "",
    participant: inbound.message.participant,
  }).link({ message: inbound.message.id, files })
}

describeE2E("@ekairos/channel e2e: webhook → agent reaction → real delivery", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>
  let runtime: ChannelE2ERuntime

  const resolveContextId = async ({ threadKey }: { channel: string; threadKey: string }) => {
    const { store } = await getContextRuntimeServices(runtime as any)
    const context = await (store as any).getOrCreateContext({ key: threadKey })
    return String(context.id)
  }

  const buildAgent = (expectsFile = false) =>
    defineReaction(
      testDomain.events.inboundReceived,
      {
        key: `channel.e2e.agent.${Date.now()}`,
        scope: testDomain,
        engine: ai({ model: REAL_MODEL }),
        sandbox: false,
      },
      async current => {
        const reply = await current.given(current.trigger).agent({
          instruction: expectsFile
            ?
            "You are a procurement assistant answering suppliers over external channels. " +
            "The inbound domain event can include a directly attached PDF file part; consume it directly. " +
            "Reply in Spanish, one short paragraph, stating how many line items the offer has " +
            "and which item is the most expensive by precio_unitario."
            : "You are a procurement assistant answering suppliers over external channels. " +
              "Reply in Spanish with one short, helpful paragraph based on the inbound message.",
          output: z.object({ reply: z.string() }),
        })
        return await current.given(reply).emit(
          testDomain.events.replyReady({ reply: reply.payload.reply })
            .link({ message: current.trigger.links.message }),
        )
      },
    )

  beforeAll(async () => {
    const app = await createTestApp({
      name: `channel-e2e-${Date.now()}`,
      token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN),
      schema: testDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({ appId, adminToken })
    runtime = new ChannelE2ERuntime({ appId, adminToken })
  }, 5 * 60 * 1000)

  afterAll(async () => {
    if (process.env.APP_TEST_PERSIST !== "true") {
      await destroyTestApp({
        appId,
        token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN),
      })
    } else {
      console.log(`[channel.e2e] persisted app: appId=${appId} adminToken=${adminToken}`)
    }
  })

  itE2E(
    "email: Mailgun webhook with attachment → agent reads it → replies through real Resend",
    async () => {
      const emailDomain = String(process.env.ESOLBAY_EMAIL_DOMAIN).trim()
      const sender = "delivered@resend.dev" // Resend's official test inbox
      const agent = buildAgent(true)

      const email = createEmailChannel(
        { identity: { from: `Ekairos Channel E2E <canal-e2e@${emailDomain}>` } },
        {
          runtime,
          resolveContextId,
          react: bindReaction({
            runtime,
            reaction: agent,
            event: inboundEvent,
            replyText: effect => effect.payload.reply,
          }),
        },
      )

      const form = new FormData()
      form.set("sender", sender)
      form.set("recipient", `compras@${emailDomain}`)
      form.set("subject", "Oferta bombas centrifugas - Licitacion 4519")
      form.set("stripped-text", "Estimados, adjunto nuestra oferta de items. Saludos.")
      form.set("Message-Id", `<e2e-${Date.now()}@acme-pumps.com>`)
      form.set(
        "attachment-1",
        new File([offerPdf()], "oferta_items.pdf", { type: "application/pdf" }),
      )

      const response = await email.webhook(
        new Request("http://localhost/api/channels/email", { method: "POST", body: form }),
      )
      expect(response.status).toBe(200)

      // --- channel domain: the email extension with its full wire truth ---
      const emailSnapshot = await db.query({
        channel_emails: {
          $: { limit: 5 },
          attachments: {},
          message: { event: { context: {} } },
        },
      } as any)
      const emailRow = asRows((emailSnapshot as any).channel_emails)[0]
      expect(emailRow?.subject).toContain("Licitacion 4519")
      expect(emailRow?.fromAddress).toBe(sender)
      expect(emailRow?.provider).toBe("mailgun")
      expect(asRows(emailRow?.attachments).length).toBe(1)

      const message = one(emailRow?.message)
      expect(message?.direction).toBe("inbound")
      expect(message?.participant).toBe(sender)

      // channel_message -> context_event -> context_context: the provenance chain.
      const event = one(message?.event)
      expect(event?.id).toBeTruthy()
      const context = one(event?.context)
      expect(context?.key).toBe(`email:${sender}`)

      // --- the reaction: the model consumed the projected file part directly ---
      const contextSnapshot = await db.query({
        context_contexts: {
          $: { where: { id: String(context?.id) }, limit: 1 },
          sessions: {
            reactions: {
              $: { order: { position: "asc" } },
              effects: {
                eventParts: { $: { order: { index: "asc" } } },
              },
            },
          },
        },
      } as any)
      const contextRow = asRows((contextSnapshot as any).context_contexts)[0]
      const session = asRows(contextRow?.sessions)[0]
      expect(session?.status).toBe("completed")

      const parts = asRows(session?.reactions).flatMap((reaction) =>
        asRows(reaction.effects).flatMap((effect) =>
          asRows(effect.eventParts).map((part) => ({ type: part.type, content: part.content })),
        ),
      )
      const actionNames = parts
        .filter((part) => part?.type === "action")
        .map((part) => part?.content?.actionName)
      expect(actionNames).toContain("respond")
      expect(actionNames.every((name) => name === "respond")).toBe(true)

      const effectSnapshot = await db.query({
        context_events: {
          $: { where: { context: String(context?.id) }, limit: 20 },
        },
      } as any)
      const replyEffect = asRows((effectSnapshot as any).context_events)
        .find((candidate) => candidate.name === "replyReady")
      expect(JSON.stringify(replyEffect?.payload)).toMatch(/3/)
      expect(JSON.stringify(replyEffect?.payload)).toContain("Motor")

      expect(parts.length).toBeGreaterThan(0)

      // --- the reply went out through real Resend ---
      const outboundSnapshot = await db.query({
        channel_messages: {
          $: { where: { direction: "outbound", channel: "email" }, limit: 5 },
        },
      } as any)
      const outbound = asRows((outboundSnapshot as any).channel_messages)[0]
      expect(outbound?.externalId).toBeTruthy() // Resend accepted: real email id
      expect(String(outbound?.text ?? "").length).toBeGreaterThan(20)
      expect(outbound?.participant).toBe(sender)

      console.log(
        `[channel.e2e] Resend delivered reply id=${outbound?.externalId} text="${String(outbound?.text).slice(0, 160)}..."`,
      )
    },
    10 * 60 * 1000,
  )

  itE2E(
    "whatsapp: Twilio webhook → agent reaction → outbound via Twilio API (mocked transport)",
    async () => {
      const fromNumber = "whatsapp:+5491155550001"
      const twilioCalls: Array<{ url: string; body: string }> = []
      const originalFetch = globalThis.fetch

      globalThis.fetch = (async (input: any, init?: any) => {
        const url = typeof input === "string" ? input : String(input?.url ?? input)
        if (url.includes("api.twilio.com")) {
          twilioCalls.push({ url, body: String(init?.body ?? "") })
          return new Response(JSON.stringify({ sid: "SM_e2e_mock" }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        }
        return originalFetch(input, init)
      }) as typeof fetch

      try {
        const agent = buildAgent()
        const whatsapp = createWhatsAppChannel(
          {
            outbound: twilio({ accountSid: "AC_e2e_mock", authToken: "mock" }),
            identity: { from: "whatsapp:+14155238886" },
          },
          {
            runtime,
            resolveContextId,
            react: bindReaction({
              runtime,
              reaction: agent,
              event: inboundEvent,
              replyText: effect => effect.payload.reply,
            }),
          },
        )

        const form = new FormData()
        form.set("From", fromNumber)
        form.set("Body", "Hola! Cuantos productos manejan para bombas centrifugas de 5HP?")
        form.set("MessageSid", "SM_inbound_e2e")
        form.set("ProfileName", "Proveedor Acme")
        form.set("WaId", "5491155550001")
        form.set("NumMedia", "0")

        const response = await whatsapp.webhook(
          new Request("http://localhost/api/channels/whatsapp", { method: "POST", body: form }),
        )
        expect(response.status).toBe(200)
        expect(await response.text()).toContain("<Response>")

        // Extension entity with the wire facts.
        const waSnapshot = await db.query({
          channel_whatsapp: {
            $: { limit: 5 },
            message: { event: { context: {} } },
          },
        } as any)
        const waRow = asRows((waSnapshot as any).channel_whatsapp)[0]
        expect(waRow?.messageSid).toBe("SM_inbound_e2e")
        expect(waRow?.profileName).toBe("Proveedor Acme")
        expect(waRow?.provider).toBe("twilio")

        const message = one(waRow?.message)
        expect(message?.direction).toBe("inbound")
        const event = one(message?.event)
        const context = one(event?.context)
        expect(context?.key).toBe(`whatsapp:${fromNumber}`)

        // The reply went out through the Twilio API with the right params.
        expect(twilioCalls.length).toBe(1)
        expect(twilioCalls[0].body).toContain(encodeURIComponent(fromNumber))

        const outboundSnapshot = await db.query({
          channel_messages: {
            $: { where: { direction: "outbound", channel: "whatsapp" }, limit: 5 },
          },
        } as any)
        const outbound = asRows((outboundSnapshot as any).channel_messages)[0]
        expect(outbound?.externalId).toBe("SM_e2e_mock")
        expect(String(outbound?.text ?? "").length).toBeGreaterThan(10)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
    10 * 60 * 1000,
  )
})

/**
 * Native channels: email and WhatsApp — first-class with the exact same
 * inbound contract (ChannelInbound) and persistence as the Chat SDK platforms.
 *
 * Provider-agnostic: the channel is the unit (email, whatsapp); providers
 * (Mailgun, Resend, Twilio, Kapso, ...) are plugins behind it. One webhook
 * per channel detects the provider from the request shape and dispatches;
 * outbound goes through a configured outbound provider. Swapping Resend for
 * SES, or Twilio for Kapso, never changes the channel surface.
 *
 * Multi-tenant by design (modeled on esolbay's production reality):
 * - runtime resolves PER INBOUND (recipient address/number → tenant runtime;
 *   null discards with a 200).
 * - outbound identity resolves per send (custom domains per org, per-org
 *   WhatsApp numbers or messaging services).
 */
import { createHmac, timingSafeEqual } from "node:crypto"

import { id as instantId } from "@instantdb/core"

import { createChannelMessage, type ChannelKind, type ChannelSendResult } from "./index.js"
import { InstantChannelMessageStore } from "./internal/message-store.js"
import type { ChannelInbound } from "./platforms.js"

type AnyRecord = Record<string, unknown>

export type ChannelRuntimeHandle = { db(): Promise<any> }

export type InboundRouting = {
  channel: ChannelKind
  /** The address/number the message was sent TO (tenant discriminator). */
  recipient: string
  /** The counterpart address/number the message came FROM. */
  participant: string
  threadKey: string
}

/**
 * Static runtime for single-tenant apps, or a resolver for multi-tenant ones
 * (recipient → org registry → org runtime). Returning null discards the
 * inbound with a 200, mirroring "unknown number/domain" handling.
 */
export type ChannelRuntimeInput =
  | ChannelRuntimeHandle
  | ((routing: InboundRouting) => Promise<ChannelRuntimeHandle | null> | ChannelRuntimeHandle | null)

export type NativeChannelContext = {
  runtime: ChannelRuntimeInput
  resolveContextId: (
    params: InboundRouting & { runtime: ChannelRuntimeHandle },
  ) => Promise<string>
  react: (inbound: ChannelInbound) => Promise<string | null | undefined | void>
}

export type NativeChannel = {
  kind: ChannelKind
  /**
   * The channel webhook. Provider detection is internal: mount ONE route per
   * channel and point every provider's webhook at it.
   */
  webhook: (request: Request) => Promise<Response>
  /** Outbound delivery to a participant (email address / phone). */
  send: (params: ChannelSendParams) => Promise<ChannelSendResult>
}

export type ChannelSendParams = {
  to: string
  text: string
  subject?: string
  html?: string
  attachments?: Array<{ filename: string; url?: string; content?: string }>
  /** Email threading: the RFC Message-Id being replied to. */
  inReplyTo?: string
  contextId?: string
  /** Per-send identity override (multi-tenant senders). */
  identity?: EmailIdentity | WhatsAppIdentity
  /** Runtime override for persistence (multi-tenant sends). */
  runtime?: ChannelRuntimeHandle
}

/**
 * Snapshot of an incoming webhook request, read once and shared across
 * provider detection: form-encoded bodies land in `form`, JSON in `json`.
 */
export type WebhookPayload = {
  request: Request
  headers: Headers
  form: FormData | null
  text: string | null
  json: AnyRecord
}

async function snapshotWebhook(request: Request): Promise<WebhookPayload> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("form-data") || contentType.includes("urlencoded")) {
    return {
      request,
      headers: request.headers,
      form: await request.formData(),
      text: null,
      json: {},
    }
  }
  const text = await request.text()
  return {
    request,
    headers: request.headers,
    form: null,
    text,
    json: asRecord(safeJsonParse(text)),
  }
}

// ===========================================================================
// EMAIL
// ===========================================================================

export type EmailIdentity = {
  /** Full sender, e.g. `"Acme - Licitaciones <licitacion+t123@compras.acme.com>"`. */
  from: string
  replyTo?: string
}

export type EmailIdentityInput =
  | EmailIdentity
  | ((params: { to: string; contextId?: string }) => Promise<EmailIdentity> | EmailIdentity)

/** Normalized inbound email, whatever provider carried it. */
export type EmailInboundMessage = {
  sender: string
  recipient: string
  subject: string
  text: string
  messageId?: string
  inReplyTo?: string
  raw: AnyRecord
  loadAttachments: (db: any, pathPrefix: string) => Promise<ChannelFileRef[]>
}

export type EmailInboundProvider = {
  name: string
  detect(payload: WebhookPayload): boolean
  parse(
    payload: WebhookPayload,
  ): Promise<{ message: EmailInboundMessage } | { response: Response }>
}

export type EmailOutboundPayload = {
  from: string
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string
  inReplyTo?: string
  attachments?: Array<{ filename: string; url?: string; content?: string }>
}

export type EmailOutboundProvider = {
  name: string
  send(payload: EmailOutboundPayload): Promise<{ externalId?: string; raw: unknown }>
}

export type EmailChannelConfig = {
  /** Default identity; per-send `identity` and resolvers override it. */
  identity: EmailIdentityInput
  /** Outbound provider. Default: `resend()`. */
  outbound?: EmailOutboundProvider
  /** Inbound providers, tried in order. Default: `[mailgunInbound(), resendInbound()]`. */
  inbound?: EmailInboundProvider[]
  attachmentsPath?: string
}

export function createEmailChannel(
  config: EmailChannelConfig,
  context: NativeChannelContext,
): NativeChannel {
  const outbound = config.outbound ?? resend()
  const inbound = config.inbound ?? [mailgunInbound(), resendInbound()]
  const pathPrefix = config.attachmentsPath ?? "/channels/email"

  const send: NativeChannel["send"] = async (params) => {
    const identity = await resolveEmailIdentity(
      (params.identity as EmailIdentity | undefined) ?? config.identity,
      { to: params.to, contextId: params.contextId },
    )
    const result = await outbound.send({
      from: identity.from,
      to: params.to,
      subject: params.subject ?? "",
      text: params.text,
      html: params.html,
      replyTo: identity.replyTo,
      inReplyTo: params.inReplyTo,
      attachments: params.attachments,
    })

    const runtime = params.runtime ?? staticRuntime(context.runtime)
    if (runtime) {
      const store = new InstantChannelMessageStore(await runtime.db())
      await store.saveChannelMessage(
        createChannelMessage({
          channel: "email",
          direction: "outbound",
          role: "assistant",
          text: params.text,
          externalId: result.externalId,
          participant: params.to,
          contextId: params.contextId,
        }),
      )
    }
    return { externalId: result.externalId, status: "sent", raw: result.raw }
  }

  const webhook = async (request: Request): Promise<Response> => {
    const payload = await snapshotWebhook(request)
    const provider = inbound.find((candidate) => candidate.detect(payload))
    if (!provider) return new Response("unrecognized email webhook", { status: 400 })

    const parsed = await provider.parse(payload)
    if ("response" in parsed) return parsed.response
    const message = parsed.message

    const routing: InboundRouting = {
      channel: "email",
      recipient: message.recipient.toLowerCase(),
      participant: message.sender,
      threadKey: `email:${message.sender.toLowerCase()}`,
    }
    const runtime = await resolveRuntime(context.runtime, routing)
    if (!runtime) return new Response("unknown recipient", { status: 200 })

    const db = await runtime.db()
    const files = await message.loadAttachments(db, pathPrefix)

    await dispatchInbound({
      context,
      runtime,
      routing,
      text: message.subject
        ? `Subject: ${message.subject}\n\n${message.text}`
        : message.text,
      files,
      raw: message.raw,
      reply: async (replyText, contextId) => {
        await send({
          to: message.sender,
          text: replyText,
          subject: message.subject ? `Re: ${message.subject}` : undefined,
          inReplyTo: message.messageId,
          contextId,
          runtime,
        })
      },
      extend: async (channelMessageId) => {
        const emailId = instantId()
        await db.transact([
          db.tx.channel_emails[emailId].update({
            subject: message.subject,
            fromAddress: message.sender,
            toAddress: message.recipient,
            messageId: message.messageId,
            inReplyTo: message.inReplyTo,
            provider: provider.name,
            createdAt: new Date(),
          }),
          db.tx.channel_emails[emailId].link({
            message: channelMessageId,
            ...(files.length ? { attachments: files.map((file) => file.fileId) } : {}),
          }),
        ])
      },
    })
    return new Response("ok", { status: 200 })
  }

  return { kind: "email", webhook, send }
}

// --- Email providers -------------------------------------------------------

/** Resend outbound provider (default). */
export function resend(options: { apiKey?: string } = {}): EmailOutboundProvider {
  return {
    name: "resend",
    async send(payload) {
      const apiKey = options.apiKey ?? process.env.RESEND_API_KEY ?? ""
      if (!apiKey) throw new Error("channel_email_send_unconfigured: set RESEND_API_KEY")

      const body: AnyRecord = {
        from: payload.from,
        to: [payload.to],
        subject: payload.subject,
        text: payload.text,
      }
      if (payload.html) body.html = payload.html
      if (payload.replyTo) body.reply_to = payload.replyTo
      if (payload.attachments?.length) {
        body.attachments = payload.attachments.map((attachment) => ({
          filename: attachment.filename,
          ...(attachment.url ? { path: attachment.url } : {}),
          ...(attachment.content ? { content: attachment.content } : {}),
        }))
      }
      if (payload.inReplyTo) {
        body.headers = { "In-Reply-To": payload.inReplyTo, References: payload.inReplyTo }
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        throw new Error(
          `channel_email_send_failed: ${response.status} ${await response.text().catch(() => "")}`,
        )
      }
      const data = (await response.json()) as { id?: string }
      return { externalId: data.id, raw: data }
    },
  }
}

/** Mailgun inbound provider (form-post webhook, HMAC-verified when keyed). */
export function mailgunInbound(options: { signingKey?: string } = {}): EmailInboundProvider {
  return {
    name: "mailgun",
    detect(payload) {
      return Boolean(payload.form && (payload.form.has("sender") || payload.form.has("body-plain")))
    },
    async parse(payload) {
      const form = payload.form as FormData
      if (options.signingKey) {
        const valid = verifyMailgunSignature({
          signingKey: options.signingKey,
          timestamp: String(form.get("timestamp") ?? ""),
          token: String(form.get("token") ?? ""),
          signature: String(form.get("signature") ?? ""),
        })
        if (!valid) return { response: new Response("invalid signature", { status: 401 }) }
      }

      const sender = String(form.get("sender") ?? form.get("from") ?? "")
      if (!sender) return { response: new Response("missing sender", { status: 400 }) }

      return {
        message: {
          sender,
          recipient: String(form.get("recipient") ?? form.get("to") ?? ""),
          subject: String(form.get("subject") ?? ""),
          text: String(form.get("stripped-text") ?? form.get("body-plain") ?? ""),
          messageId: String(form.get("Message-Id") ?? "") || undefined,
          inReplyTo: String(form.get("In-Reply-To") ?? "") || undefined,
          raw: { provider: "mailgun", sender, subject: String(form.get("subject") ?? "") },
          loadAttachments: (db, pathPrefix) =>
            uploadFormAttachments({ db, form, pathPrefix }),
        },
      }
    },
  }
}

/** Resend receiving inbound provider (`email.received`, Svix-verified when keyed). */
export function resendInbound(
  options: { webhookSecret?: string; apiKey?: string } = {},
): EmailInboundProvider {
  return {
    name: "resend",
    detect(payload) {
      if (payload.headers.get("svix-id")) return true
      return typeof payload.json.type === "string" && payload.json.type.startsWith("email.")
    },
    async parse(payload) {
      if (options.webhookSecret) {
        const valid = verifySvixSignature({
          secret: options.webhookSecret,
          id: payload.headers.get("svix-id") ?? "",
          timestamp: payload.headers.get("svix-timestamp") ?? "",
          signature: payload.headers.get("svix-signature") ?? "",
          payload: payload.text ?? "",
        })
        if (!valid) return { response: new Response("invalid signature", { status: 401 }) }
      }

      if (payload.json.type !== "email.received") {
        return { response: new Response("ignored", { status: 200 }) }
      }

      const apiKey = options.apiKey ?? process.env.RESEND_API_KEY ?? ""
      const data = asRecord(payload.json.data)
      const emailId = String(data.email_id ?? data.id ?? "")
      const received = apiKey && emailId
        ? await fetchResendReceivedEmail(apiKey, emailId)
        : data

      const sender = firstAddress(received.from) ?? firstAddress(data.from) ?? ""
      if (!sender) return { response: new Response("missing sender", { status: 400 }) }
      const attachments = Array.isArray(received.attachments) ? received.attachments : []

      return {
        message: {
          sender,
          recipient: firstAddress(received.to) ?? firstAddress(data.to) ?? "",
          subject: String(received.subject ?? ""),
          text: String(received.text ?? stripHtml(String(received.html ?? ""))),
          messageId: String(received.message_id ?? "") || undefined,
          raw: { provider: "resend", emailId },
          loadAttachments: (db, pathPrefix) =>
            uploadResendAttachments({ db, apiKey, attachments, pathPrefix }),
        },
      }
    },
  }
}

// ===========================================================================
// WHATSAPP
// ===========================================================================

export type WhatsAppIdentity = {
  /** e.g. "whatsapp:+14155238886". */
  from?: string
  /** Pooled senders (Twilio Messaging Service). Wins over `from`. */
  messagingServiceSid?: string
}

export type WhatsAppIdentityInput =
  | WhatsAppIdentity
  | ((params: { to: string; contextId?: string }) => Promise<WhatsAppIdentity> | WhatsAppIdentity)

/** Normalized inbound WhatsApp message, whatever provider carried it. */
export type WhatsAppInboundMessage = {
  from: string
  to: string
  text: string
  messageSid?: string
  profileName?: string
  waId?: string
  raw: AnyRecord
  loadMedia: (db: any, pathPrefix: string) => Promise<ChannelFileRef[]>
  /** Provider-expected acknowledgement (TwiML, plain 200, ...). */
  ack: () => Response
}

export type WhatsAppInboundProvider = {
  name: string
  detect(payload: WebhookPayload): boolean
  parse(
    payload: WebhookPayload,
  ): Promise<{ message: WhatsAppInboundMessage } | { response: Response }>
}

export type WhatsAppOutboundProvider = {
  name: string
  sendText(params: {
    identity: WhatsAppIdentity
    to: string
    text: string
  }): Promise<{ externalId?: string; raw: unknown }>
  sendTemplate(params: {
    identity: WhatsAppIdentity
    to: string
    contentSid: string
    variables?: Record<string, string>
    language?: string
  }): Promise<{ externalId?: string; raw: unknown }>
}

export type WhatsAppChannelConfig = {
  /** Default sender identity; per-send and resolvers override. */
  identity?: WhatsAppIdentityInput
  /** Outbound provider. Default: `twilio()`. */
  outbound?: WhatsAppOutboundProvider
  /** Inbound providers, tried in order. Default: `[twilioInbound(), kapsoInbound()]`. */
  inbound?: WhatsAppInboundProvider[]
  /**
   * Template name → Content SID map. Names also resolve through
   * `TWILIO_WHATSAPP_TEMPLATE_<NAME>` env vars; "HX..." values pass through.
   */
  templates?: Record<string, string>
  attachmentsPath?: string
}

export type WhatsAppTemplateParams = {
  to: string
  template: string
  variables?: Record<string, string>
  language?: string
  contextId?: string
  identity?: WhatsAppIdentity
  runtime?: ChannelRuntimeHandle
}

export type WhatsAppInteractiveParams = {
  to: string
  body: string
  buttons: Array<{ id: string; title: string }>
  contextId?: string
  identity?: WhatsAppIdentity
  runtime?: ChannelRuntimeHandle
}

export type WhatsAppNativeChannel = NativeChannel & {
  /** Content template — the escape hatch outside the 24h window. */
  sendTemplate: (params: WhatsAppTemplateParams) => Promise<ChannelSendResult>
  /** Interactive buttons (numbered text menu; templates for rich buttons). */
  sendInteractive: (params: WhatsAppInteractiveParams) => Promise<ChannelSendResult>
}

export function createWhatsAppChannel(
  config: WhatsAppChannelConfig,
  context: NativeChannelContext,
): WhatsAppNativeChannel {
  const outbound = config.outbound ?? twilio()
  const inbound = config.inbound ?? [twilioInbound(), kapsoInbound()]
  const pathPrefix = config.attachmentsPath ?? "/channels/whatsapp"

  const resolveIdentity = async (params: {
    to: string
    contextId?: string
    override?: WhatsAppIdentity
  }): Promise<WhatsAppIdentity> => {
    if (params.override) return params.override
    const input = config.identity
    if (!input) return { from: process.env.TWILIO_WHATSAPP_FROM ?? "" }
    return typeof input === "function" ? await input(params) : input
  }

  const persistOutbound = async (params: {
    to: string
    text: string
    externalId?: string
    contextId?: string
    runtime?: ChannelRuntimeHandle
  }) => {
    const runtime = params.runtime ?? staticRuntime(context.runtime)
    if (!runtime) return
    const store = new InstantChannelMessageStore(await runtime.db())
    await store.saveChannelMessage(
      createChannelMessage({
        channel: "whatsapp",
        direction: "outbound",
        role: "assistant",
        text: params.text,
        externalId: params.externalId,
        participant: params.to,
        contextId: params.contextId,
      }),
    )
  }

  const send: NativeChannel["send"] = async (params) => {
    const identity = await resolveIdentity({
      to: params.to,
      contextId: params.contextId,
      override: params.identity as WhatsAppIdentity | undefined,
    })
    const result = await outbound.sendText({ identity, to: params.to, text: params.text })
    await persistOutbound({ ...params, externalId: result.externalId })
    return { externalId: result.externalId, status: "sent", raw: result.raw }
  }

  const sendTemplate: WhatsAppNativeChannel["sendTemplate"] = async (params) => {
    const identity = await resolveIdentity(params)
    const result = await outbound.sendTemplate({
      identity,
      to: params.to,
      contentSid: resolveTemplateSid(params.template, config.templates),
      variables: params.variables,
      language: params.language,
    })
    await persistOutbound({
      to: params.to,
      text: `[template:${params.template}] ${JSON.stringify(params.variables ?? {})}`,
      externalId: result.externalId,
      contextId: params.contextId,
      runtime: params.runtime,
    })
    return { externalId: result.externalId, status: "sent", raw: result.raw }
  }

  const sendInteractive: WhatsAppNativeChannel["sendInteractive"] = async (params) => {
    const menu = [
      params.body,
      "",
      ...params.buttons.map((button, index) => `${index + 1}. ${button.title}`),
    ].join("\n")
    return await send({ ...params, text: menu })
  }

  const webhook = async (request: Request): Promise<Response> => {
    const payload = await snapshotWebhook(request)
    const provider = inbound.find((candidate) => candidate.detect(payload))
    if (!provider) return new Response("unrecognized whatsapp webhook", { status: 400 })

    const parsed = await provider.parse(payload)
    if ("response" in parsed) return parsed.response
    const message = parsed.message

    const routing: InboundRouting = {
      channel: "whatsapp",
      recipient: message.to,
      participant: message.from,
      threadKey: `whatsapp:${message.from}`,
    }
    const runtime = await resolveRuntime(context.runtime, routing)
    if (!runtime) return message.ack()

    const db = await runtime.db()
    const files = await message.loadMedia(db, pathPrefix)

    await dispatchInbound({
      context,
      runtime,
      routing,
      text: message.text,
      files,
      raw: message.raw,
      reply: async (replyText, contextId) => {
        await send({ to: message.from, text: replyText, contextId, runtime })
      },
      extend: async (channelMessageId) => {
        const rowId = instantId()
        await db.transact([
          db.tx.channel_whatsapp[rowId].update({
            messageSid: message.messageSid,
            profileName: message.profileName,
            waId: message.waId,
            mediaCount: files.length,
            provider: provider.name,
            createdAt: new Date(),
          }),
          db.tx.channel_whatsapp[rowId].link({ message: channelMessageId }),
        ])
      },
    })
    return message.ack()
  }

  return { kind: "whatsapp", webhook, send, sendTemplate, sendInteractive }
}

// --- WhatsApp providers ----------------------------------------------------

/** Twilio outbound provider (default). */
export function twilio(
  options: { accountSid?: string; authToken?: string } = {},
): WhatsAppOutboundProvider {
  const credentials = () => {
    const accountSid = options.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? ""
    const authToken = options.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? ""
    if (!accountSid || !authToken) {
      throw new Error("channel_whatsapp_send_unconfigured: set TWILIO_ACCOUNT_SID/AUTH_TOKEN")
    }
    return { accountSid, authToken }
  }

  const dispatch = async (body: Record<string, string>) => {
    const { accountSid, authToken } = credentials()
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(body),
      },
    )
    if (!response.ok) {
      throw new Error(
        `channel_whatsapp_send_failed: ${response.status} ${await response.text().catch(() => "")}`,
      )
    }
    const data = (await response.json()) as { sid?: string }
    return { externalId: data.sid, raw: data }
  }

  const senderBody = (identity: WhatsAppIdentity, to: string): Record<string, string> => {
    const body: Record<string, string> = {
      To: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
    }
    if (identity.messagingServiceSid) {
      body.MessagingServiceSid = identity.messagingServiceSid
    } else if (identity.from) {
      body.From = identity.from.startsWith("whatsapp:")
        ? identity.from
        : `whatsapp:${identity.from}`
    } else {
      throw new Error("channel_whatsapp_identity_unresolved: provide from or messagingServiceSid")
    }
    return body
  }

  return {
    name: "twilio",
    sendText: ({ identity, to, text }) => dispatch({ ...senderBody(identity, to), Body: text }),
    sendTemplate: ({ identity, to, contentSid, variables, language }) =>
      dispatch({
        ...senderBody(identity, to),
        ContentSid: contentSid,
        ...(variables ? { ContentVariables: JSON.stringify(variables) } : {}),
        ...(language ? { ContentLanguage: language } : {}),
      }),
  }
}

/** Twilio inbound provider (form webhook, signature-verified when url given). */
export function twilioInbound(
  options: { accountSid?: string; authToken?: string; webhookUrl?: string } = {},
): WhatsAppInboundProvider {
  return {
    name: "twilio",
    detect(payload) {
      return Boolean(payload.form && payload.form.has("From"))
    },
    async parse(payload) {
      const form = payload.form as FormData
      const authToken = options.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? ""

      if (options.webhookUrl && authToken) {
        const paramsRecord: Record<string, string> = {}
        form.forEach((value, key) => {
          if (typeof value === "string") paramsRecord[key] = value
        })
        const valid = verifyTwilioSignature({
          authToken,
          url: options.webhookUrl,
          params: paramsRecord,
          signature: payload.headers.get("x-twilio-signature") ?? "",
        })
        if (!valid) return { response: new Response("invalid signature", { status: 401 }) }
      }

      const from = String(form.get("From") ?? "")
      if (!from) return { response: new Response("missing From", { status: 400 }) }
      const accountSid = options.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? ""

      return {
        message: {
          from,
          to: String(form.get("To") ?? ""),
          text: String(form.get("Body") ?? ""),
          messageSid: String(form.get("MessageSid") ?? "") || undefined,
          profileName: String(form.get("ProfileName") ?? "") || undefined,
          waId: String(form.get("WaId") ?? "") || undefined,
          raw: { provider: "twilio", from, messageSid: form.get("MessageSid") },
          loadMedia: (db, pathPrefix) =>
            uploadTwilioMedia({ db, form, accountSid, authToken, pathPrefix }),
          ack: twiml,
        },
      }
    },
  }
}

/** Kapso inbound provider (JSON webhook, HMAC-verified when keyed). */
export function kapsoInbound(options: { webhookSecret?: string } = {}): WhatsAppInboundProvider {
  return {
    name: "kapso",
    detect(payload) {
      if (payload.headers.get("x-webhook-signature")) return true
      return Boolean(payload.json.message || payload.json.conversation)
    },
    async parse(payload) {
      if (options.webhookSecret) {
        const signature = payload.headers.get("x-webhook-signature") ?? ""
        const expected = createHmac("sha256", options.webhookSecret)
          .update(payload.text ?? "")
          .digest("hex")
        if (!safeEqual(signature, expected)) {
          return { response: new Response("invalid signature", { status: 401 }) }
        }
      }

      const message = asRecord(payload.json.message)
      const conversation = asRecord(payload.json.conversation)
      const from = String(message.from ?? conversation.phone_number ?? "")
      if (!from) return { response: new Response("ignored", { status: 200 }) }

      return {
        message: {
          from,
          to: String(conversation.phone_number_id ?? ""),
          text: extractKapsoText(message),
          messageSid: String(message.id ?? "") || undefined,
          waId: from.replace(/\D/g, "") || undefined,
          raw: { provider: "kapso", message, conversation },
          loadMedia: async () => [],
          ack: () => new Response("ok", { status: 200 }),
        },
      }
    },
  }
}

// ===========================================================================
// Shared inbound dispatch (mirrors the platform runtime pipeline)
// ===========================================================================

async function dispatchInbound(params: {
  context: NativeChannelContext
  runtime: ChannelRuntimeHandle
  routing: InboundRouting
  text: string
  files: ChannelFileRef[]
  raw: AnyRecord
  reply: (text: string, contextId: string) => Promise<void>
  /** Persists the per-channel extension entity for this message. */
  extend?: (channelMessageId: string) => Promise<void>
}): Promise<void> {
  const contextId = await params.context.resolveContextId({
    ...params.routing,
    runtime: params.runtime,
  })

  const parts: unknown[] = [{ type: "text", text: params.text }]
  for (const file of params.files) {
    parts.push({ type: "file", fileId: file.fileId, filename: file.filename })
  }

  const db = await params.runtime.db()
  const store = new InstantChannelMessageStore(db)
  const inboundMessage = await store.saveChannelMessage(
    createChannelMessage({
      channel: params.routing.channel,
      direction: "inbound",
      role: "user",
      text: params.text,
      parts,
      participant: params.routing.participant,
      raw: params.raw,
      contextId,
    }),
  )

  if (params.extend) {
    await params.extend(inboundMessage.id)
  }

  const inbound: ChannelInbound = {
    channel: params.routing.channel,
    threadKey: params.routing.threadKey,
    contextId,
    message: inboundMessage,
    reply: (text: string) => params.reply(text, contextId),
    attachEvent: async (eventId: string) => {
      await db.transact([
        db.tx.channel_messages[inboundMessage.id].link({
          event: eventId,
          context: contextId,
        }),
      ])
    },
  }

  const replyText = await params.context.react(inbound)
  if (replyText) await inbound.reply(replyText)
}

async function resolveRuntime(
  input: ChannelRuntimeInput,
  routing: InboundRouting,
): Promise<ChannelRuntimeHandle | null> {
  if (typeof input === "function") return await input(routing)
  return input
}

/** The static runtime when configured directly; null when it is a resolver. */
function staticRuntime(input: ChannelRuntimeInput): ChannelRuntimeHandle | null {
  return typeof input === "function" ? null : input
}

async function resolveEmailIdentity(
  input: EmailIdentityInput,
  params: { to: string; contextId?: string },
): Promise<EmailIdentity> {
  return typeof input === "function" ? await input(params) : input
}

function resolveTemplateSid(
  template: string,
  templates: Record<string, string> | undefined,
): string {
  if (template.startsWith("HX")) return template
  const configured = templates?.[template]
  if (configured) return configured
  const envKey = `TWILIO_WHATSAPP_TEMPLATE_${template.toUpperCase()}`
  const fromEnv = process.env[envKey]
  if (fromEnv) return fromEnv
  throw new Error(
    `channel_whatsapp_template_unresolved: "${template}" — configure templates.${template} or ${envKey}`,
  )
}

// ===========================================================================
// Webhook signature verification
// ===========================================================================

export function verifyMailgunSignature(params: {
  signingKey: string
  timestamp: string
  token: string
  signature: string
}): boolean {
  if (!params.timestamp || !params.token || !params.signature) return false
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(params.timestamp))
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false
  const expected = createHmac("sha256", params.signingKey)
    .update(params.timestamp + params.token)
    .digest("hex")
  return safeEqual(params.signature, expected)
}

export function verifyTwilioSignature(params: {
  authToken: string
  url: string
  params: Record<string, string>
  signature: string
}): boolean {
  if (!params.signature) return false
  const data =
    params.url +
    Object.keys(params.params)
      .sort()
      .map((key) => key + params.params[key])
      .join("")
  const expected = createHmac("sha1", params.authToken).update(data).digest("base64")
  return safeEqual(params.signature, expected)
}

export function verifySvixSignature(params: {
  secret: string
  id: string
  timestamp: string
  signature: string
  payload: string
}): boolean {
  if (!params.id || !params.timestamp || !params.signature) return false
  const secret = params.secret.startsWith("whsec_")
    ? Buffer.from(params.secret.slice("whsec_".length), "base64")
    : Buffer.from(params.secret, "base64")
  const expected = createHmac("sha256", secret)
    .update(`${params.id}.${params.timestamp}.${params.payload}`)
    .digest("base64")
  // svix-signature: space-separated list of "v1,<base64>" entries.
  return params.signature
    .split(" ")
    .map((entry) => entry.split(",")[1] ?? "")
    .some((candidate) => candidate && safeEqual(candidate, expected))
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

// ===========================================================================
// Attachments
// ===========================================================================

export type ChannelFileRef = {
  fileId: string
  filename: string
}

async function uploadFormAttachments(params: {
  db: any
  form: FormData
  pathPrefix: string
}): Promise<ChannelFileRef[]> {
  const files: ChannelFileRef[] = []
  const entries: Array<[string, FormDataEntryValue]> = []
  params.form.forEach((value, key) => entries.push([key, value]))
  for (const [key, value] of entries) {
    if (!/^attachment-\d+$/.test(key) || typeof value === "string") continue
    const file = value as File
    const buffer = Buffer.from(await file.arrayBuffer())
    const filename = file.name || key
    const path = `${params.pathPrefix}/${Date.now()}-${sanitize(filename)}`
    const uploaded = await params.db.storage.uploadFile(path, buffer, {
      contentType: attachmentContentType(file.type, filename),
      contentDisposition: filename,
    })
    const fileId = uploaded?.data?.id
    if (fileId) {
      await params.db.transact([
        params.db.tx.$files[fileId].update({
          contentType: attachmentContentType(file.type, filename),
        }),
      ])
      files.push({ fileId: String(fileId), filename })
    }
  }
  return files
}

function attachmentContentType(contentType: string, filename: string): string {
  if (contentType && contentType !== "application/octet-stream") return contentType
  if (filename.toLowerCase().endsWith(".csv")) return "text/csv"
  return contentType || "application/octet-stream"
}

async function uploadResendAttachments(params: {
  db: any
  apiKey: string
  attachments: unknown[]
  pathPrefix: string
}): Promise<ChannelFileRef[]> {
  const files: ChannelFileRef[] = []
  for (const value of params.attachments) {
    const attachment = asRecord(value)
    const url = String(attachment.download_url ?? attachment.url ?? "")
    const filename = String(attachment.filename ?? attachment.name ?? "attachment")
    if (!url) continue
    const response = await fetch(url, {
      headers: params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : undefined,
    })
    if (!response.ok) continue
    const buffer = Buffer.from(await response.arrayBuffer())
    const path = `${params.pathPrefix}/${Date.now()}-${sanitize(filename)}`
    const uploaded = await params.db.storage.uploadFile(path, buffer, {
      contentType: String(attachment.content_type ?? "application/octet-stream"),
      contentDisposition: filename,
    })
    const fileId = uploaded?.data?.id
    if (fileId) files.push({ fileId: String(fileId), filename })
  }
  return files
}

async function uploadTwilioMedia(params: {
  db: any
  form: FormData
  accountSid: string
  authToken: string
  pathPrefix: string
}): Promise<ChannelFileRef[]> {
  const count = Number(params.form.get("NumMedia") ?? 0)
  if (!count || !params.accountSid) return []
  const auth = `Basic ${Buffer.from(`${params.accountSid}:${params.authToken}`).toString("base64")}`
  const files: ChannelFileRef[] = []
  for (let index = 0; index < count; index += 1) {
    const url = String(params.form.get(`MediaUrl${index}`) ?? "")
    const contentType = String(params.form.get(`MediaContentType${index}`) ?? "application/octet-stream")
    if (!url) continue
    const response = await fetch(url, { headers: { Authorization: auth } })
    if (!response.ok) continue
    const buffer = Buffer.from(await response.arrayBuffer())
    const extension = contentType.split("/")[1] ?? "bin"
    const filename = `media-${index}.${sanitize(extension)}`
    const path = `${params.pathPrefix}/${Date.now()}-${filename}`
    const uploaded = await params.db.storage.uploadFile(path, buffer, { contentType })
    const fileId = uploaded?.data?.id
    if (fileId) files.push({ fileId: String(fileId), filename })
  }
  return files
}

// ===========================================================================
// Provider payload helpers
// ===========================================================================

async function fetchResendReceivedEmail(apiKey: string, emailId: string): Promise<AnyRecord> {
  const response = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) return {}
  return asRecord(await response.json())
}

function extractKapsoText(message: AnyRecord): string {
  const type = String(message.type ?? "text")
  if (type === "interactive") {
    const interactive = asRecord(message.interactive)
    const reply = asRecord(interactive.button_reply ?? interactive.list_reply)
    return String(reply.id ?? reply.title ?? "")
  }
  const text = asRecord(message.text)
  return String(text.body ?? message.body ?? "")
}

function firstAddress(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/<([^>]+)>/)
    return (match?.[1] ?? value).trim().toLowerCase() || null
  }
  if (Array.isArray(value)) return firstAddress(value[0])
  const record = asRecord(value)
  if (record.email) return String(record.email).toLowerCase()
  if (record.address) return String(record.address).toLowerCase()
  return null
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function twiml(): Response {
  return new Response("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  })
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : {}
}

function sanitize(value: string): string {
  return value.replace(/[^\w.-]+/g, "_")
}

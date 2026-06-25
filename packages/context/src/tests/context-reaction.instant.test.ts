/* @vitest-environment node */

import { resolve } from "node:path"

import { createOpenAI } from "@ai-sdk/openai"
import { init } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { config as dotenvConfig } from "dotenv"
import { afterAll, beforeAll, expect, it } from "vitest"
import { z } from "zod"

import { domain, EkairosRuntime } from "@ekairos/domain"
import {
  Context,
  Part,
  contextDomain,
  createAiSdkStepEngine,
  defineEvent,
  defineReaction,
} from "../index.js"
import {
  describeInstant,
  destroyContextTestApp,
  hasInstantProvisionToken,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"

const emailReceivedInput = z.object({
  from: z.string().email(),
  to: z.string().email(),
  subject: z.string(),
  body: z.string(),
})

const emailDomain = domain("email")
  .includes(contextDomain)
  .withSchema({
    entities: {
      email_messages: i.entity({
        subject: i.string().indexed(),
        receivedAt: i.date().indexed(),
      }),
    },
    links: {},
    rooms: {},
  })
  .withEvents({
    received: defineEvent({
      description: "A supplier email was received.",
      payload: emailReceivedInput,
      channel: "email",
      content: ({ payload }) => ({
        subject: payload.subject,
        from: payload.from,
        to: payload.to,
      }),
      parts: ({ payload }) => [
        Part.message({
          text: payload.body,
        }),
      ],
    }),
  })

const appDomain = domain("context-test-app")
  .includes(emailDomain)
  .withSchema({
    entities: {},
    links: {},
    rooms: {},
  })

type TestRuntimeEnv = {
  appId: string
  adminToken: string
}

class ContextTestRuntime extends EkairosRuntime<
  TestRuntimeEnv,
  typeof appDomain,
  ReturnType<typeof init>
> {
  protected getDomain() {
    return appDomain
  }

  protected async resolveDb(env: TestRuntimeEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: appDomain.instantSchema(),
      useDateObjects: true,
    } as any)
  }
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value as Record<string, unknown>[] : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

describeInstant("@ekairos/context", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "context-framework",
      schema: appDomain.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({
      appId,
      adminToken,
      schema: appDomain.instantSchema(),
      useDateObjects: true,
    } as any)
  }, 60_000)

  afterAll(async () => {
    await destroyContextTestApp(appId)
  }, 60_000)

  itInstant("creates typed domain events and completes a typed reaction", async () => {
    const runtime = new ContextTestRuntime({ appId, adminToken })
    const email = await Context(runtime).use(emailDomain)
    const trigger = await email.events.received({
      from: "supplier@example.com",
      to: "accounting@example.com",
      subject: "Factura OC 4400131133",
      body: "Adjunto factura para la orden 4400131133.",
    }, {
      key: "email:received:deterministic",
    })

    expect(trigger.kind).toBe("email.received")
    expect(trigger.domain).toBe("email")
    expect(trigger.name).toBe("received")
    expect(trigger.channel).toBe("email")

    const outputSchema = z.object({
      orderCode: z.string(),
      language: z.literal("es"),
    })

    const reaction = defineReaction({
      key: "email.extract-order",
      scope: emailDomain,
      context: z.object({
        inboxId: z.string(),
      }),
      output: outputSchema,
      engine: {
        step: async ({ step }) => {
          expect(step.key).toBe("extract-order")
          return {
            orderCode: "4400131133",
            language: "es",
          }
        },
      },
      run: async ({ execution }) => {
        const extracted = await execution.step("extract-order", {
          instructions: "Extract the purchase order code from the received email.",
          output: outputSchema,
        })
        await execution.complete(extracted)
      },
    })(runtime)

    const result = await reaction.react(
      { key: "email-context:deterministic" },
      trigger,
      {
        env: { appId, adminToken },
        context: {
          inboxId: "inbox_1",
        },
      },
    )

    expect(result.result?.output).toEqual({
      orderCode: "4400131133",
      language: "es",
    })

    const snapshot = await db.query({
      event_contexts: {
        $: { where: { key: "email-context:deterministic" }, limit: 1 },
        executions: {
          input: {},
          output: {},
          steps: {
            $: { order: { iteration: "asc" } },
            parts: {
              $: { order: { idx: "asc" } },
            },
          },
        },
      },
      event_items: {
        $: { where: { key: "email:received:deterministic" }, limit: 1 },
      },
    } as any)

    const persistedTrigger = rows((snapshot as any).event_items)[0]
    expect(persistedTrigger?.kind).toBe("email.received")
    expect(record(persistedTrigger?.data).subject).toBe("Factura OC 4400131133")

    const contextRow = rows((snapshot as any).event_contexts)[0]
    const execution = rows(contextRow?.executions)[0]
    expect(execution?.status).toBe("completed")
    expect(record(execution?.input).kind).toBe("email.received")
    expect(record(execution?.output).status).toBe("completed")

    const steps = rows(execution?.steps)
    expect(steps.map((step) => step.status)).toEqual(["completed"])
    expect(JSON.stringify(steps[0]?.parts)).toContain("4400131133")
  }, 60_000)

  const itRealAi = hasAzureEnv() && hasInstantProvisionToken() ? it : it.skip

  itRealAi("runs a real Azure-backed typed reaction", async () => {
    const runtime = new ContextTestRuntime({ appId, adminToken })
    const email = await Context(runtime).use(emailDomain)
    const trigger = await email.events.received({
      from: "supplier@example.com",
      to: "accounting@example.com",
      subject: "Factura recibida para OC 4400131133",
      body: "Hola, adjunto la factura correspondiente a la orden de compra 4400131133. Gracias.",
    }, {
      key: `email:received:azure:${Date.now()}`,
    })

    const outputSchema = z.object({
      orderCode: z.string().describe("Purchase order code mentioned in the email."),
      documentKind: z.enum(["invoice", "credit_note", "debit_note", "unknown"]),
    })

    const reaction = defineReaction({
      key: "email.azure-extract-order",
      scope: emailDomain,
      context: z.object({ inboxId: z.string() }),
      output: outputSchema,
      engine: createAiSdkStepEngine({
        model: getAzureResponsesModel(),
        system: "Extract structured accounting intake data. Return only values grounded in the provided event.",
      }),
      run: async ({ execution }) => {
        const extracted = await execution.step("extract-accounting-intake", {
          instructions: "Read the email and extract the purchase order code and document kind.",
          output: outputSchema,
        })
        await execution.complete(extracted)
      },
    })(runtime)

    const result = await reaction.react(
      { key: `email-context:azure:${Date.now()}` },
      trigger,
      {
        env: { appId, adminToken },
        context: { inboxId: "inbox_azure" },
      },
    )

    expect(result.result?.output?.orderCode).toBe("4400131133")
    expect(result.result?.output?.documentKind).toBe("invoice")
  }, 120_000)
})

function loadEsolbayAzureEnv() {
  const candidates = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), "..", "..", "client", "esolbay", "esolbay-platform", ".env.local"),
    resolve(process.cwd(), "..", "..", "..", "client", "esolbay", "esolbay-platform", ".env.local"),
  ]
  for (const path of candidates) {
    dotenvConfig({ path, quiet: true })
  }
}

function readEnv(name: string) {
  return String(process.env[name] ?? "").trim()
}

function hasAzureEnv() {
  loadEsolbayAzureEnv()
  return Boolean(
    (readEnv("AZURE_API_KEY") || readEnv("AZURE_OPENAI_API_KEY")) &&
      (readEnv("AZURE_OPENAI_ENDPOINT") || readEnv("AZURE_RESOURCE_NAME")),
  )
}

function getAzureResponsesModel() {
  loadEsolbayAzureEnv()
  const apiKey = readEnv("AZURE_API_KEY") || readEnv("AZURE_OPENAI_API_KEY")
  const endpoint = readEnv("AZURE_OPENAI_ENDPOINT")
  const resourceName = readEnv("AZURE_RESOURCE_NAME")
  const apiVersion = readEnv("AZURE_API_VERSION") || "2025-04-01-preview"
  const modelId = readEnv("AI_MODEL_CONTEXT_FRAMEWORK_TEST") || "gpt-5.2"
  const baseURL = endpoint
    ? endpoint.replace(/\/+$/, "").endsWith("/openai")
      ? endpoint.replace(/\/+$/, "")
      : `${endpoint.replace(/\/+$/, "")}/openai`
    : `https://${resourceName}.openai.azure.com/openai`

  const provider = createOpenAI({
    apiKey,
    baseURL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    fetch: async (input, init) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url
      const url = new URL(rawUrl)
      if (!url.searchParams.has("api-version")) {
        url.searchParams.set("api-version", apiVersion)
      }
      return fetch(url.toString(), init)
    },
  })

  return provider.responses(modelId as any)
}

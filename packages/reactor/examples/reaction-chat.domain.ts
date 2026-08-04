import { defineAction, defineEvent, domain } from "@ekairos/domain"
import { contextDomain } from "@ekairos/events"
import { i } from "@instantdb/core"
import { z } from "zod"

export const requestSchema = z.object({
  text: z.string().min(1),
})

export const planSchema = z.object({
  objective: z.string().min(1),
  workstreams: z.array(z.enum(["research", "risks"])).length(2),
})

export const researchSchema = z.object({
  objective: z.string().min(1),
  findings: z.array(z.string().min(1)).min(2),
  evidenceCount: z.number().int().positive(),
})

export const risksSchema = z.object({
  objective: z.string().min(1),
  risks: z.array(z.object({
    risk: z.string().min(1),
    mitigation: z.string().min(1),
  })).min(2),
})

export const synthesisSchema = z.object({
  objective: z.string().min(1),
  summary: z.string().min(1),
  recommendation: z.string().min(1),
  evidenceCount: z.number().int().positive(),
  riskCount: z.number().int().positive(),
})

export const publishedReportSchema = synthesisSchema.extend({
  reportId: z.string().min(1),
  status: z.literal("published"),
})

const reactionChatSchemaDomain = domain("reactionChatExample")
  .includes(contextDomain)
  .withSchema({
    entities: {
      reactionChatExample_report: i.entity({
        objective: i.string(),
        summary: i.string(),
        recommendation: i.string(),
        evidenceCount: i.number(),
        riskCount: i.number(),
        status: i.string().indexed(),
      }),
    },
    links: {},
    rooms: {},
  })
  .withEvents({
    requestReceived: defineEvent({ payload: requestSchema }),
  })

const publishReport = defineAction({
  description: "Publish the converged scripted report as one idempotent durable record.",
  input: synthesisSchema,
  output: publishedReportSchema,
  async execute({ input, domain }, executionContext) {
    "use step"
    if (!executionContext) throw new Error("reaction_chat_execution_context_required")

    const reportId = executionContext.reactionId
    await domain.db.transact([
      domain.db.tx.reactionChatExample_report[reportId].update({
        ...input,
        status: "published",
      }),
    ])

    return publishedReportSchema.parse({
      ...input,
      reportId,
      status: "published",
    })
  },
})

export const reactionChatDomain = reactionChatSchemaDomain.withActions({ publishReport })

export const reactionChatScope = reactionChatDomain.scope({
  events: [reactionChatDomain.events.requestReceived],
  actions: [reactionChatDomain.actions.publishReport],
})

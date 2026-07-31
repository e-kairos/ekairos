import { dataset, datasetDomain } from "@ekairos/dataset"
import { Context } from "@ekairos/context"
import {
  defineDomainAction,
  defineEvent,
  domain,
} from "@ekairos/domain"
import { contextDomain } from "@ekairos/events"
import {
  ai,
} from "@ekairos/reactor"
import { sandboxDomain } from "@ekairos/sandbox/domain"
import { i } from "@instantdb/core"
import { z } from "zod"

import { getAzureModel } from "./azure"
import type { WorkbenchRuntime } from "./runtime"

export const workbenchScenarioSchema = z.enum(["chat", "review"])
export type WorkbenchScenario = z.infer<typeof workbenchScenarioSchema>

export const workbenchItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1),
})

export const workbenchAnalysisSchema = z.object({
  objective: z.string().min(1).max(500),
  constraints: z.array(z.string().min(1).max(300)).max(8),
  risks: z.array(z.object({
    risk: z.string().min(1).max(500),
    severity: z.enum(["low", "medium", "high"]),
  })).max(8),
})

export const workbenchDecisionSchema = z.object({
  recommendation: z.enum(["proceed", "clarify", "reject"]),
  summary: z.string().min(1).max(500),
  answer: z.string().min(1).max(3_000),
})

export const workbenchVerificationSchema = z.object({
  valid: z.boolean(),
  summary: z.string().min(1).max(500),
})

const workbenchCore = domain("workbench")
  .includes(contextDomain)
  .includes(datasetDomain)
  .includes(sandboxDomain)
  .withSchema({
    entities: {
      workbench_reviews: i.entity({
        request: i.string(),
        datasetId: i.string().indexed(),
        itemCount: i.number(),
        riskCount: i.number(),
        recommendation: i.string().indexed(),
        summary: i.string(),
        status: i.string().indexed(),
        createdAt: i.date().indexed(),
        updatedAt: i.date().indexed(),
      }),
    },
    links: {
      workbenchReviewDataset: {
        forward: { on: "workbench_reviews", has: "one", label: "dataset" },
        reverse: { on: "dataset_datasets", has: "many", label: "reviews" },
      },
    },
    rooms: {},
  })
  .withEvents({
    messageReceived: defineEvent({
      payload: z.object({
        text: z.string().min(1),
        scenario: workbenchScenarioSchema,
      }),
      links: {
        files: { on: "$files", has: "many" },
      },
    }),
    messageAnswered: defineEvent({
      payload: z.object({ text: z.string().min(1) }),
    }),
    reviewCompleted: defineEvent({
      payload: z.object({
        text: z.string().min(1),
        reviewId: z.string().min(1),
        datasetId: z.string().min(1),
        itemCount: z.number().int().nonnegative(),
        recommendation: z.enum(["proceed", "clarify", "reject"]),
        artifactCount: z.number().int().nonnegative(),
        repositoryCommit: z.string().optional(),
        verification: workbenchVerificationSchema,
      }),
      links: {
        review: { on: "workbench_reviews", has: "one" },
        files: { on: "$files", has: "many" },
      },
    }),
    reviewVerificationRequested: defineEvent({
      payload: z.object({
        reviewId: z.string().min(1),
        datasetId: z.string().min(1),
        itemCount: z.number().int().nonnegative(),
        riskCount: z.number().int().nonnegative(),
        recommendation: z.enum(["proceed", "clarify", "reject"]),
      }),
      links: {
        review: { on: "workbench_reviews", has: "one" },
      },
    }),
    reviewVerificationCompleted: defineEvent({
      payload: z.object({
        reviewId: z.string().min(1),
        valid: z.boolean(),
        summary: z.string().min(1).max(500),
      }),
      links: {
        review: { on: "workbench_reviews", has: "one" },
      },
    }),
  })

const readReviewPolicy = defineDomainAction({
  description: "Return the durable review policy that must be applied before recommending a decision.",
  input: z.object({
    focus: z.enum(["items", "risks", "decision"]),
  }),
  output: z.object({
    maximumUnresolvedRisks: z.number().int().nonnegative(),
    requireExplicitNextStep: z.boolean(),
    focus: z.enum(["items", "risks", "decision"]),
  }),
  execute: async ({ input }) => ({
    maximumUnresolvedRisks: 2,
    requireExplicitNextStep: true,
    focus: input.focus,
  }),
})

const workbenchReactionDomain = workbenchCore
  .withActions({ readReviewPolicy })
  .withActions(datasetDomain.actions)
  .withActions(sandboxDomain.actions)

async function verifyRecordedReview(input: {
  runtime: WorkbenchRuntime
  contextKey: string
  reviewId: string
  datasetId: string
  itemCount: number
  riskCount: number
  recommendation: "proceed" | "clarify" | "reject"
}): Promise<z.infer<typeof workbenchVerificationSchema> & { eventId: string }> {
  const scope = workbenchDomain.scope({
    events: [workbenchDomain.events.reviewVerificationRequested],
    actions: [],
  })
  await using session = await Context(input.runtime).session(
    input.contextKey,
    scope,
    ai({ model: async () => await getAzureModel(), maxRounds: 4 }),
    { sandbox: false },
  )
  const requested = workbenchDomain.events.reviewVerificationRequested({
    reviewId: input.reviewId,
    datasetId: input.datasetId,
    itemCount: input.itemCount,
    riskCount: input.riskCount,
    recommendation: input.recommendation,
  }).link({ review: input.reviewId })
  const verification = await session.from(requested).agent({
    instruction: [
      "Verify that the persisted review is internally consistent.",
      "A review is valid when item and risk counts are nonnegative and the recommendation is coherent.",
      "Return a short factual summary; do not perform or request any action.",
    ].join(" "),
    output: workbenchVerificationSchema,
    datasets: false,
  })
  const completed = await session.context.append(
    workbenchReactionDomain.events.reviewVerificationCompleted({
      reviewId: input.reviewId,
      valid: verification.payload.valid,
      summary: verification.payload.summary,
    }).link({ review: input.reviewId }),
  )
  return { ...verification.payload, eventId: completed.id }
}

const recordReview = defineDomainAction({
  description: "Persist the reviewed request and link it to its validated formal Dataset.",
  input: z.object({
    reviewId: z.string().min(1),
    request: z.string().min(1),
    items: dataset(workbenchItemSchema),
    itemCount: z.number().int().nonnegative(),
    riskCount: z.number().int().nonnegative(),
    decision: workbenchDecisionSchema,
  }),
  output: z.object({
    reviewId: z.string(),
    datasetId: z.string(),
    status: z.literal("recorded"),
    verification: workbenchVerificationSchema.extend({ eventId: z.string() }),
  }),
  execute: async (
    { input, domain: activeDomain, runtime },
    executionContext,
  ) => {
    "use step"

    if (!executionContext) {
      throw new Error("workbench_review_session_context_required")
    }

    const db = (activeDomain as any).db
    const datasetResult = await db.query({
      dataset_datasets: {
        $: { where: { datasetId: input.items.datasetId }, limit: 1 },
      },
    } as any)
    const datasetEntity = datasetResult.dataset_datasets?.[0]
    if (!datasetEntity) throw new Error(`workbench_review_dataset_not_found:${input.items.datasetId}`)

    const reviewResult = await db.query({
      workbench_reviews: {
        $: { where: { id: input.reviewId }, limit: 1 },
      },
    } as any)
    const existingReview = reviewResult.workbench_reviews?.[0]
    const now = new Date()
    await db.transact([
      db.tx.workbench_reviews[input.reviewId]
        .update({
          request: input.request,
          datasetId: input.items.datasetId,
          itemCount: input.itemCount,
          riskCount: input.riskCount,
          recommendation: input.decision.recommendation,
          summary: input.decision.summary,
          status: "recorded",
          createdAt: existingReview?.createdAt ?? now,
          updatedAt: now,
        })
        .link({ dataset: datasetEntity.id }),
    ])
    const verification = await verifyRecordedReview({
      runtime: runtime as WorkbenchRuntime,
      contextKey: executionContext.context.key,
      reviewId: input.reviewId,
      datasetId: input.items.datasetId,
      itemCount: input.itemCount,
      riskCount: input.riskCount,
      recommendation: input.decision.recommendation,
    })
    return {
      reviewId: input.reviewId,
      datasetId: input.items.datasetId,
      status: "recorded" as const,
      verification,
    }
  },
})

export const workbenchDomain = workbenchCore
  .withActions(workbenchReactionDomain.actions)
  .withActions({ recordReview })

export const workbenchSchema = workbenchDomain.instantSchema()

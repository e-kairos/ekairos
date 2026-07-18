import "server-only"

import type { ContextEvent } from "@ekairos/events"
import { uuidV5 } from "@ekairos/events"
import { defineReaction } from "@ekairos/reactor"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

import { getAzureModel } from "./azure"
import {
  workbenchAnalysisSchema,
  workbenchDecisionSchema,
  workbenchDomain,
  workbenchItemSchema,
} from "./domain"

class WorkbenchEngine {
  readonly kind = "ekairos.ai" as const
  readonly model = async () => await getAzureModel()

  constructor(readonly maxRounds = 8) {}

  static [WORKFLOW_SERIALIZE](instance: WorkbenchEngine) {
    return { maxRounds: instance.maxRounds }
  }

  static [WORKFLOW_DESERIALIZE](data: { maxRounds: number }) {
    return new WorkbenchEngine(data.maxRounds)
  }
}

function engine(maxRounds = 8) {
  return new WorkbenchEngine(maxRounds)
}

export function createChatReaction(history: readonly ContextEvent[]) {
  return defineReaction(
    workbenchDomain.events.messageReceived,
    {
      key: "workbench.answer-message",
      scope: workbenchDomain,
      engine: engine(6),
      sandbox: false,
    },
    async reaction => {
      const answer = await reaction.given(history).agent({
        instruction: [
          "Answer the latest user message as a concise, technically precise assistant.",
          "Use the preceding messageReceived and messageAnswered Events as conversation history.",
          "Return only the answer intended for the user.",
        ].join(" "),
      })
      return await reaction.given(answer).emit(
        workbenchDomain.events.messageAnswered({ text: answer.payload }),
      )
    },
  )
}

export function createReviewReaction(input: {
  sandboxId: string
  repositoryUrl: string
}) {
  return defineReaction(
    workbenchDomain.events.messageReceived,
    {
      key: "workbench.review-request",
      scope: workbenchDomain,
      engine: engine(12),
      sandbox: input.sandboxId,
    },
    async reaction => {
      const [repository, attachments] = await Promise.all([
        reaction.given(reaction.trigger).git({
          operation: "clone",
          key: "reference",
          url: input.repositoryUrl,
          depth: 1,
        }),
        reaction.given(reaction.trigger).loadFiles(),
      ])

      const [items, analysis] = await Promise.all([
        reaction.given(attachments).dataset({
          instruction: [
            "Extract one row per requested item from the files materialized for this Event.",
            "Preserve quantity and unit exactly when stated.",
            "Do not invent products that are not present in the request.",
          ].join(" "),
          schema: workbenchItemSchema,
        }),
        reaction.given(attachments).agent({
          instruction: [
            "Before producing the analysis, call workbench.readReviewPolicy with focus risks and apply its result.",
            "Identify the objective, explicit constraints, and concrete procurement risks.",
            "Return no more than eight concise constraints and eight concise risks.",
          ].join(" "),
          output: workbenchAnalysisSchema,
          actions: [workbenchDomain.actions.readReviewPolicy],
        }),
      ])

      const decision = await reaction.given([repository, items, analysis]).agent({
        path: repository.payload.path,
        instruction: [
          "Produce a concise Markdown review from the formal item Dataset, analysis, and repository Event.",
          "The answer must mention the extracted item count and clearly state what should happen next.",
          "Include the exact logical repository path and stay under 250 words.",
        ].join(" "),
        output: workbenchDecisionSchema,
      })

      const generated = await reaction.given(decision).shell({
        command: "python3",
        args: [
          "-c",
          [
            "from pathlib import Path",
            "import os",
            "Path('workbench-review.md').write_text(os.environ['WORKBENCH_REPORT'], encoding='utf-8')",
          ].join("; "),
        ],
        path: repository.payload.path,
        env: { WORKBENCH_REPORT: decision.payload.answer },
      })
      if (!generated.payload.success) {
        throw new Error(
          `workbench_report_generation_failed:${generated.payload.error || generated.payload.output}`,
        )
      }

      const published = await reaction.given(generated).storeFiles({
        path: repository.payload.path,
        files: "workbench-review.md",
      })
      const committed = await reaction.given(published).git({
        operation: "commit",
        path: repository.payload.path,
        message: "Add generated workbench review",
        authorName: "Ekairos Workbench",
        authorEmail: "workbench@ekairos.dev",
      })

      const datasetId = items.payload.datasetId
      const itemCount = items.payload.count ?? items.payload.preview.length
      const riskRows = analysis.payload.risks
      const reviewId = uuidV5(`workbench:review:${datasetId}`)
      const recorded = await reaction.given([
        items,
        analysis,
        decision,
        published,
        committed,
      ]).action(
        workbenchDomain.actions.recordReview,
        {
          reviewId,
          request: reaction.trigger.payload.text,
          items: { datasetId },
          itemCount,
          riskCount: riskRows.length,
          decision: decision.payload,
        },
      )

      return await reaction.given(recorded).emit(
        workbenchDomain.events.reviewCompleted({
          text: decision.payload.answer,
          reviewId,
          datasetId,
          itemCount,
          recommendation: decision.payload.recommendation,
          artifactCount: published.payload.files.length,
          verification: recorded.payload.verification,
          ...(committed.payload.commitSha
            ? { repositoryCommit: committed.payload.commitSha }
            : {}),
        }).link({
          review: reviewId,
          files: published.payload.files.map(file => file.fileId),
        }),
      )
    },
  )
}

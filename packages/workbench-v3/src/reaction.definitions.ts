import "server-only"

import { Context } from "@ekairos/context"
import type { ContextEvent } from "@ekairos/events"
import { uuidV5 } from "@ekairos/events"
import { ai } from "@ekairos/reactor"

import { getAzureModel } from "./azure"
import {
  workbenchAnalysisSchema,
  workbenchDecisionSchema,
  workbenchDomain,
  workbenchItemSchema,
} from "./domain"
import type { PreparedWorkbenchReaction } from "./reaction.input"

const chatScope = workbenchDomain.scope({
  events: [
    workbenchDomain.events.messageReceived,
    workbenchDomain.events.messageAnswered,
    workbenchDomain.events.reviewCompleted,
  ],
  actions: [],
})

const reviewScope = workbenchDomain.scope({
  events: [workbenchDomain.events.messageReceived],
  actions: [
    workbenchDomain.actions.readReviewPolicy,
    workbenchDomain.actions.recordReview,
  ],
})

export async function answerChatMessage(input: PreparedWorkbenchReaction) {
  await using session = await Context(input.runtime).session(
    input.contextKey,
    chatScope,
    ai({ model: async () => await getAzureModel(), maxRounds: 6 }),
    { sandbox: false },
  )
  const history = triggerFirst(input.trigger, input.history)
  const answer = await session.from(history).agent({
    instruction: [
      "Answer the latest user message as a concise, technically precise assistant.",
      "Use the preceding messageReceived and messageAnswered Events as conversation history.",
      "Return only the answer intended for the user.",
    ].join(" "),
    datasets: false,
  })
  return await session.context.append(
    workbenchDomain.events.messageAnswered({ text: answer.payload }),
  )
}

export async function reviewRequest(input: PreparedWorkbenchReaction & {
  sandboxId: string
  repositoryUrl: string
}) {
  await using session = await Context(input.runtime).session(
    input.contextKey,
    reviewScope,
    ai({ model: async () => await getAzureModel(), maxRounds: 12 }),
    { sandbox: input.sandboxId },
  )
  const [repository, attachments] = await Promise.all([
    session.from(input.trigger).git({
      operation: "clone",
      key: "reference",
      url: input.repositoryUrl,
      depth: 1,
    }),
    session.from(input.trigger).loadFiles(),
  ])

  const [items, analysis] = await Promise.all([
    session.from(attachments).dataset({
      instruction: [
        "Extract one row per requested item from the files materialized for this Event.",
        "Preserve quantity and unit exactly when stated.",
        "Do not invent products that are not present in the request.",
      ].join(" "),
      schema: workbenchItemSchema,
    }),
    session.from(attachments).agent({
      instruction: [
        "Before producing the analysis, call workbench.readReviewPolicy with focus risks and apply its result.",
        "Identify the objective, explicit constraints, and concrete procurement risks.",
        "Return no more than eight concise constraints and eight concise risks.",
      ].join(" "),
      output: workbenchAnalysisSchema,
      actions: [workbenchDomain.actions.readReviewPolicy],
    }),
  ])

  const decision = await session.from([repository, items, analysis]).agent({
    instruction: [
      "Produce a concise Markdown review from the formal item Dataset, analysis, and repository Event.",
      "The answer must mention the extracted item count and clearly state what should happen next.",
      "Include the exact logical repository path and stay under 250 words.",
    ].join(" "),
    output: workbenchDecisionSchema,
  })

  const generated = await session.from(decision).shell({
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

  const published = await session.from(generated).storeFiles({
    path: repository.payload.path,
    files: "workbench-review.md",
  })
  const committed = await session.from(published).git({
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
  const request = workbenchDomain.events.messageReceived.payload
    .parse(input.trigger.payload)
  const recorded = await session.from([
    items,
    analysis,
    decision,
    published,
    committed,
  ]).action(
    workbenchDomain.actions.recordReview,
    {
      reviewId,
      request: request.text,
      items: { datasetId },
      itemCount,
      riskCount: riskRows.length,
      decision: decision.payload,
    },
  )

  return await session.context.append(
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
}

function triggerFirst(
  trigger: ContextEvent,
  history: readonly ContextEvent[],
) {
  return Object.freeze([
    trigger,
    ...history.filter(event => event.id !== trigger.id),
  ])
}

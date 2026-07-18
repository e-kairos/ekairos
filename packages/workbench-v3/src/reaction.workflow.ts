import "server-only"

import {
  createChatReaction,
  createReviewReaction,
} from "./reaction.definitions"
import type { PreparedWorkbenchReaction } from "./reaction.input"

export async function answerMessageWorkflow(input: PreparedWorkbenchReaction) {
  "use workflow"

  const definition = input.scenario === "review"
    ? createReviewReaction({
        sandboxId: requiredSandboxId(input),
        repositoryUrl: requiredRepositoryUrl(input),
      })
    : createChatReaction(input.history)
  const answered = await input.context.react(input.trigger, definition)
  return answered
}

function requiredSandboxId(input: PreparedWorkbenchReaction) {
  if (!input.sandboxId) throw new Error("workbench_review_sandbox_required")
  return input.sandboxId
}

function requiredRepositoryUrl(input: PreparedWorkbenchReaction) {
  if (!input.repositoryUrl) throw new Error("workbench_review_repository_required")
  return input.repositoryUrl
}

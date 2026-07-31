import "server-only"

import {
  answerChatMessage,
  reviewRequest,
} from "./reaction.definitions"
import type { PreparedWorkbenchReaction } from "./reaction.input"

export async function answerMessageWorkflow(input: PreparedWorkbenchReaction) {
  "use workflow"

  return input.scenario === "review"
    ? await reviewRequest({
        ...input,
        sandboxId: requiredSandboxId(input),
        repositoryUrl: requiredRepositoryUrl(input),
      })
    : await answerChatMessage(input)
}

function requiredSandboxId(input: PreparedWorkbenchReaction) {
  if (!input.sandboxId) throw new Error("workbench_review_sandbox_required")
  return input.sandboxId
}

function requiredRepositoryUrl(input: PreparedWorkbenchReaction) {
  if (!input.repositoryUrl) throw new Error("workbench_review_repository_required")
  return input.repositoryUrl
}

import { runReactionOperation } from "./reaction.operation.js"
import type {
  ReactionOperationRequest,
  ReactionOperationResult,
} from "./reaction.operation.contract.js"

export async function agent(
  request: ReactionOperationRequest,
): Promise<ReactionOperationResult> {
  "use step"
  return await runReactionOperation(request)
}

export async function action(
  request: ReactionOperationRequest,
): Promise<ReactionOperationResult> {
  "use step"
  return await runReactionOperation(request)
}

export async function dataset(
  request: ReactionOperationRequest,
): Promise<ReactionOperationResult> {
  "use step"
  return await runReactionOperation(request)
}

export async function loadFiles(
  request: ReactionOperationRequest,
): Promise<ReactionOperationResult> {
  "use step"
  return await runReactionOperation(request)
}

export async function storeFiles(
  request: ReactionOperationRequest,
): Promise<ReactionOperationResult> {
  "use step"
  return await runReactionOperation(request)
}

export async function shell(
  request: ReactionOperationRequest,
): Promise<ReactionOperationResult> {
  "use step"
  return await runReactionOperation(request)
}

export async function git(
  request: ReactionOperationRequest,
): Promise<ReactionOperationResult> {
  "use step"
  return await runReactionOperation(request)
}

export async function emit(
  request: ReactionOperationRequest,
): Promise<ReactionOperationResult> {
  "use step"
  return await runReactionOperation(request)
}

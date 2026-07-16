import type {
  ContextRuntimeServiceHandle,
} from "@ekairos/events"

export type ReactionReturnedEvents = Readonly<{
  cardinality: "one" | "many"
  eventIds: readonly string[]
}>

export type ReactionCompletion = Readonly<{
  contextId: string
  sessionId: string
  returned: ReactionReturnedEvents
}>

export type ReactionWorkflowPayload = Readonly<{
  reactionKey: string
  runtime: ContextRuntimeServiceHandle
  contextId: string
  triggerId: string
  sessionId: string
  rootReactionId: string
  sandboxId?: string
  parentSessionId?: string
  returnHookToken?: string
}>

export type ReactionWorkflow = (
  payload: ReactionWorkflowPayload,
) => Promise<ReactionCompletion>

export type ReactionReturnHookPayload =
  | Readonly<{ ok: true; completion: ReactionCompletion }>
  | Readonly<{
      ok: false
      error: Readonly<{ name?: string; message: string; stack?: string }>
    }>

export async function startReactionWorkflow(input: {
  workflow: ReactionWorkflow
  payload: ReactionWorkflowPayload
}) {
  "use step"
  const { start } = await import("workflow/api")
  const run = await start(input.workflow, [input.payload])
  return { runId: String(run.runId) }
}
export async function readReactionWorkflowReturnValue(runId: string) {
  "use step"
  const { getRun } = await import("workflow/api")
  return await getRun<ReactionCompletion>(runId).returnValue
}

export async function persistReactionWorkflowRun(input: {
  runtime: ContextRuntimeServiceHandle
  sessionId: string
  runId: string
}) {
  "use step"
  const db = await input.runtime.db()
  await db.transact([
    db.tx.context_sessions[input.sessionId].update({
      workflowRunId: input.runId,
      updatedAt: new Date(),
    }),
  ])
}

export async function resumeReactionReturnHook(input: {
  token: string
  payload: ReactionReturnHookPayload
}) {
  "use step"
  const { resumeHook } = await import("workflow/api")
  await resumeHook(input.token, input.payload)
}

export function serializeReactionError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  return { message: String(error) }
}

export function unwrapReactionReturnHook(payload: ReactionReturnHookPayload) {
  if (payload.ok) return payload.completion
  const error = new Error(payload.error.message)
  error.name = payload.error.name ?? "Error"
  if (payload.error.stack) error.stack = payload.error.stack
  throw error
}

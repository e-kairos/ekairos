export type ActionExecutionContext = {
  workflowRunId: string | null
  stepId: string | null
  attempt: number | null
  inWorkflow: boolean
  inStep: boolean
}

export async function readActionExecutionContext(): Promise<ActionExecutionContext> {
  let workflowRunId: string | null = null
  let stepId: string | null = null
  let attempt: number | null = null

  try {
    const { getWorkflowMetadata } = await import("workflow")
    const workflowMeta = getWorkflowMetadata?.() as
      | { workflowRunId?: string | number | null }
      | null
      | undefined
    if (workflowMeta?.workflowRunId !== undefined && workflowMeta?.workflowRunId !== null) {
      workflowRunId = String(workflowMeta.workflowRunId)
    }
  } catch {
    workflowRunId = null
  }

  try {
    const { getStepMetadata } = await import("workflow")
    const stepMeta = getStepMetadata?.() as
      | { stepId?: string | null; attempt?: number | null }
      | null
      | undefined
    if (stepMeta?.stepId) {
      stepId = String(stepMeta.stepId)
    }
    if (typeof stepMeta?.attempt === "number") {
      attempt = stepMeta.attempt
    }
  } catch {
    stepId = null
    attempt = null
  }

  return {
    workflowRunId,
    stepId,
    attempt,
    inWorkflow: Boolean(workflowRunId),
    inStep: Boolean(stepId),
  }
}

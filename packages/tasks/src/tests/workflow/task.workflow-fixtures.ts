import { z } from "zod"

import {
  approvalOutcomeSchema,
  Task,
  type TasksRuntime,
} from "../../index.ts"

export const scoreOutcomeSchema = z.object({
  score: z.number().int(),
  label: z.string(),
})

export async function typedTaskOutcomeWorkflow(
  runtime: TasksRuntime,
  input: { id: string },
) {
  "use workflow"

  const task = await Task.get(runtime, input.id, scoreOutcomeSchema)
  const outcome = await task.outcome()

  return {
    id: task.id,
    kind: task.kind,
    outcome,
  }
}

export async function approvalTaskOutcomeWorkflow(
  runtime: TasksRuntime,
  input: { id: string },
) {
  "use workflow"

  const task = await Task.get(runtime, input.id, approvalOutcomeSchema)
  const outcome = await task.outcome()

  return approvalOutcomeSchema.parse(outcome)
}

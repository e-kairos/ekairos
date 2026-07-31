import type {
  ReactionEngine,
  ReactionEngineActions,
  ReactionEngineInput,
} from "@ekairos/reactor/internal"
import type { ContextPartEnvelope } from "@ekairos/events"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

export type DeterministicActionStep = Readonly<{
  action: string
  input: unknown
}>

type DeterministicPlan =
  | readonly DeterministicActionStep[]
  | ((input: ReactionEngineInput<any, any, any>) =>
      | readonly DeterministicActionStep[]
      | Promise<readonly DeterministicActionStep[]>)

export function actionStep(
  action: string,
  input: Record<string, unknown>,
): DeterministicActionStep {
  return Object.freeze({ action, input })
}

export function deterministicReactionEngine(
  options: { steps: DeterministicPlan },
): ReactionEngine<any> {
  return new DeterministicReactionEngine(options.steps)
}

class DeterministicReactionEngine implements ReactionEngine<any> {
  constructor(private readonly plan: DeterministicPlan) {}

  static [WORKFLOW_SERIALIZE](instance: DeterministicReactionEngine) {
    if (typeof instance.plan === "function") {
      throw new Error("deterministic_reaction_engine_plan_not_workflow_serializable")
    }
    return { steps: instance.plan }
  }

  static [WORKFLOW_DESERIALIZE](data: { steps: readonly DeterministicActionStep[] }) {
    return new DeterministicReactionEngine(data.steps)
  }

  async agent<TOutput, TActions extends ReactionEngineActions>(
    input: ReactionEngineInput<any, TOutput, TActions>,
  ) {
    const steps = typeof this.plan === "function" ? await this.plan(input) : this.plan
    let completion: Record<string, unknown> | undefined
    const parts: ContextPartEnvelope[] = []

    for (const step of steps) {
      const [actionName, action] = resolveAction(input.actions, step.action)
      const callId = `deterministic:${parts.length}`
      const parsedInput = action.input.parse(step.input)
      parts.push({
        type: "action",
        content: { status: "started", actionName, actionCallId: callId, input: parsedInput },
      })
      const output = action.output.parse(await action.execute(parsedInput))
      parts.push({
        type: "action",
        content: { status: "completed", actionName, actionCallId: callId, output },
      })
      const record = output && typeof output === "object"
        ? output as Record<string, unknown>
        : undefined
      if (record?.fatal === true) {
        throw new Error(String(record.error ?? record.message ?? `${actionName} failed`))
      }

      const summary = record?.summary ?? (step.input as any)?.summary
      completion = {
        completed: true,
        action: actionName,
        ...(summary === undefined ? {} : { summary }),
        output,
      }
    }

    if (!completion) throw new Error("deterministic_reaction_engine_plan_empty")
    return {
      output: input.output ? input.output.parse(completion) : completion as TOutput,
      parts,
      metadata: { engine: "deterministic" },
    }
  }
}

function resolveAction(
  actions: ReactionEngineActions,
  requestedName: string,
): [string, ReactionEngineActions[string]] {
  const matches = Object.entries(actions).filter(([name]) =>
    name === requestedName || name.endsWith(`.${requestedName}`),
  )
  if (matches.length !== 1) {
    throw new Error(
      `deterministic_reaction_action_${matches.length === 0 ? "missing" : "ambiguous"}:${requestedName}`,
    )
  }
  return matches[0]!
}

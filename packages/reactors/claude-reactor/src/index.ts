import type {
  ReactionEngine,
  ReactionEngineActions,
  ReactionEngineInput,
} from "@ekairos/reactor"

export type ClaudeTurnResult = {
  text: string
}

export type ClaudeExecuteTurn<
  TContext = unknown,
> = <
  TOutput,
  TActions extends ReactionEngineActions,
>(
  input: ReactionEngineInput<TContext, TOutput, TActions>,
) => Promise<ClaudeTurnResult>

export type ClaudeEngineOptions<TContext = unknown> = {
  executeTurn: ClaudeExecuteTurn<TContext>
}

function parseStructuredOutput(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced?.[1]) return JSON.parse(fenced[1].trim())
    throw new Error("claude_engine_output_json_required")
  }
}

export class ClaudeEngine<TContext = unknown>
  implements ReactionEngine<TContext> {
  readonly executeTurn: ClaudeExecuteTurn<TContext>

  constructor(options: ClaudeEngineOptions<TContext>) {
    this.executeTurn = options.executeTurn
  }

  async agent<TOutput, TActions extends ReactionEngineActions>(
    input: ReactionEngineInput<TContext, TOutput, TActions>,
  ) {
    if (Object.keys(input.actions).length > 0) {
      throw new Error("claude_engine_actions_not_supported")
    }

    const turn = await this.executeTurn(input)
    return {
      output: input.output ? parseStructuredOutput(turn.text) : turn.text as TOutput,
      metadata: { provider: "claude" },
    }
  }
}

export function claudeEngine<TContext = unknown>(
  options: ClaudeEngineOptions<TContext>,
): ClaudeEngine<TContext> {
  return new ClaudeEngine(options)
}

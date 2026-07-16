import type {
  ReactionEngine,
  ReactionEngineActions,
  ReactionEngineInput,
} from "@ekairos/reactor"

export type CursorTurnResult = {
  text: string
}

export type CursorExecuteTurn<
  TContext = unknown,
> = <
  TOutput,
  TActions extends ReactionEngineActions,
>(
  input: ReactionEngineInput<TContext, TOutput, TActions>,
) => Promise<CursorTurnResult>

export type CursorEngineOptions<TContext = unknown> = {
  executeTurn: CursorExecuteTurn<TContext>
}

function parseStructuredOutput(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced?.[1]) return JSON.parse(fenced[1].trim())
    throw new Error("cursor_engine_output_json_required")
  }
}

export class CursorEngine<TContext = unknown>
  implements ReactionEngine<TContext> {
  readonly executeTurn: CursorExecuteTurn<TContext>

  constructor(options: CursorEngineOptions<TContext>) {
    this.executeTurn = options.executeTurn
  }

  async agent<TOutput, TActions extends ReactionEngineActions>(
    input: ReactionEngineInput<TContext, TOutput, TActions>,
  ) {
    if (Object.keys(input.actions).length > 0) {
      throw new Error("cursor_engine_actions_not_supported")
    }

    const turn = await this.executeTurn(input)
    return {
      output: input.output ? parseStructuredOutput(turn.text) : turn.text as TOutput,
      metadata: { provider: "cursor" },
    }
  }
}

export function cursorEngine<TContext = unknown>(
  options: CursorEngineOptions<TContext>,
): CursorEngine<TContext> {
  return new CursorEngine(options)
}

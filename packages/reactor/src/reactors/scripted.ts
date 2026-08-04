import type {
  ReactionEngine,
  ReactionEngineActions,
  ReactionEngineInput,
  ReactionEngineResult,
  ReactionEngineStream,
  ReactionEngineStreamEmission,
} from "../reactor.js"

const SCRIPTED_STREAM_KINDS = new Set([
  "text.delta",
  "reasoning.delta",
  "reasoning.completed",
  "source.available",
  "provider.event",
] as const)

export type ScriptedStreamEmission = ReactionEngineStreamEmission & Readonly<{
  kind:
    | "text.delta"
    | "reasoning.delta"
    | "reasoning.completed"
    | "source.available"
    | "provider.event"
}>

export type ScriptedReactionStream =
  | Iterable<ScriptedStreamEmission>
  | AsyncIterable<ScriptedStreamEmission>

export type ScriptedEngineStream = Omit<ReactionEngineStream, "emit"> & Readonly<{
  emit(input: ScriptedStreamEmission): ReturnType<ReactionEngineStream["emit"]>
}>

export type ScriptedAgentInput<TContext = unknown> = Omit<
  ReactionEngineInput<TContext, unknown, ReactionEngineActions>,
  "stream"
> & Readonly<{
  stream?: ScriptedEngineStream
}>

export type ScriptedReactionResult = ReactionEngineResult<unknown> & Readonly<{
  stream?: ScriptedReactionStream
}>

export type ScriptedAgent<TContext = unknown> = (
  input: ScriptedAgentInput<TContext>,
) => ScriptedReactionResult | Promise<ScriptedReactionResult>

export type ScriptedReactionEngineOptions<TContext = unknown> = Readonly<{
  agent: ScriptedAgent<TContext>
}>

/**
 * Deterministic ReactionEngine with the same contextual input as `ai(...)`.
 *
 * The handler owns scripted content. Reactor continues to own reaction/model
 * lifecycle chunks, output validation, durable Events, Parts, and retries.
 */
export function scripted<TContext = unknown>(
  options: ScriptedReactionEngineOptions<TContext>,
): ReactionEngine<TContext> {
  if (!options || typeof options.agent !== "function") {
    throw new Error("scripted_agent_required")
  }

  return Object.freeze({
    async agent<TOutput, TActions extends ReactionEngineActions>(
      input: ReactionEngineInput<TContext, TOutput, TActions>,
    ): Promise<ReactionEngineResult<TOutput>> {
      const handlerInput = toScriptedAgentInput(input)
      const result = await options.agent(handlerInput)
      if (!result || typeof result !== "object" || !("output" in result)) {
        throw new Error("scripted_result_required")
      }

      if (result.stream) {
        for await (const emission of result.stream) {
          assertScriptedStreamEmission(emission)
          await handlerInput.stream?.emit(emission)
        }
      }

      return Object.freeze({
        output: result.output as TOutput,
        ...(result.parts ? { parts: Object.freeze([...result.parts]) } : {}),
        metadata: Object.freeze({
          ...(result.metadata ?? {}),
          engine: "scripted",
        }),
      })
    },
  })
}

function toScriptedAgentInput<TContext, TOutput, TActions extends ReactionEngineActions>(
  input: ReactionEngineInput<TContext, TOutput, TActions>,
): ScriptedAgentInput<TContext> {
  const stream = input.stream
    ? Object.freeze({
        ...input.stream,
        async emit(emission: ScriptedStreamEmission) {
          assertScriptedStreamEmission(emission)
          return await input.stream!.emit(emission)
        },
      })
    : undefined
  return Object.freeze({
    ...input,
    ...(stream ? { stream } : {}),
  }) as ScriptedAgentInput<TContext>
}

function assertScriptedStreamEmission(
  emission: ScriptedStreamEmission,
): void {
  if (!emission || typeof emission !== "object") {
    throw new Error("scripted_stream_emission_required")
  }
  if (!SCRIPTED_STREAM_KINDS.has(emission.kind)) {
    throw new Error(`scripted_stream_kind_owned_by_framework:${emission.kind}`)
  }
}

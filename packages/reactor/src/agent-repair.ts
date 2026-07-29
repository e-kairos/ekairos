import type { ModelMessage } from "ai"
import { z } from "zod"

import {
  runReactionEngineAgent as runEngineAgentAttempt,
  type ReactionAgentEffectDraft,
  type ReactionAgentEffectJournal,
  type ReactionAgentRunResult,
} from "./agent.js"
import {
  actionPartsToModelMessages,
} from "./reaction-view.js"
import {
  agentRepairMessage,
  agentWireError,
  agentWireValidationFailure,
  formatZodError,
  resolveAgentRepairRetries,
  type AgentWireValidationFailure,
} from "./agent-output-repair.js"
import {
  isAiEngine,
  type AnyReactionEngine,
  type ReactionEngineInput,
} from "./reactor.js"

const REPAIRABLE_AGENT_ERRORS = [
  "reaction_agent_output_not_delivered",
  "reaction_agent_respond_must_be_terminal",
  "reaction_engine_empty_response",
  "reaction_engine_result_required",
]

export async function runReactionEngineAgent<TContext, TOutput>(input: {
  engine: AnyReactionEngine<TContext>
  request: ReactionEngineInput<TContext, TOutput>
  effects: ReactionAgentEffectJournal
}): Promise<ReactionAgentRunResult<TOutput>> {
  const repairRetries = resolveAgentRepairRetries(
    input.request.repairRetries ??
      (isAiEngine(input.engine) ? input.engine.repairRetries : undefined),
  )
  let messages: ModelMessage[] = [...input.request.messages]
  let actions = input.request.actions
  let lastFailure: AgentWireValidationFailure | undefined
  let lastResponse: unknown

  for (let attempt = 0; attempt <= repairRetries; attempt += 1) {
    const drafts: ReactionAgentEffectDraft[] = []
    const trackedOutput = input.request.output
      ? trackParsedValue(input.request.output, value => { lastResponse = value })
      : undefined
    const attemptEngine = isAiEngine(input.engine)
      ? input.engine
      : guardCustomEngineResult(
          input.engine,
          trackedOutput,
          value => { lastResponse = value },
        )
    try {
      return await runEngineAgentAttempt({
        engine: attemptEngine,
        request: {
          ...input.request,
          messages,
          actions,
          ...(trackedOutput ? { output: trackedOutput } : {}),
        },
        effects: {
          id: key => input.effects.id(
            attempt === 0 ? key : `repair:${attempt}:${key}`,
          ),
          async record(draft) {
            drafts.push(draft)
            if (draft.type === "context.model") {
              lastResponse = draft.metadata.modelResponse ?? draft.payload
            }
            return await input.effects.record(draft)
          },
        },
      })
    } catch (error) {
      if (!isRepairableAgentError(error)) throw error
      const validation = error instanceof z.ZodError
        ? formatZodError(error)
        : error instanceof Error ? error.message : String(error)
      const failure = agentWireValidationFailure({
        kind: error instanceof z.ZodError ? "output" : "malformed_response",
        target: input.request.output ? "reaction output" : "reaction response",
        validation,
        expectedSchema: input.request.output
          ? safeJsonSchema(input.request.output)
          : { type: "string", minLength: 1 },
        response: lastResponse,
      })
      lastFailure = failure

      if (attempt >= repairRetries) {
        throw agentWireError("reaction_agent_repair_exhausted", {
          maxRounds: input.request.maxRounds,
          repairsUsed: attempt,
          repairRetries,
          failure,
          response: lastResponse,
        })
      }

      messages = [
        ...messages,
        ...drafts.flatMap(draft =>
          actionPartsToModelMessages(draft.parts, name => name)),
        invalidOutputMessage(lastResponse),
        agentRepairMessage(failure, attempt + 1, repairRetries),
      ]
      // Repairs receive the prior action results as messages and only correct
      // the malformed terminal value, so completed side effects cannot repeat.
      actions = Object.freeze({})
    }
  }

  throw agentWireError("reaction_agent_repair_exhausted", {
    maxRounds: input.request.maxRounds,
    repairsUsed: repairRetries,
    repairRetries,
    failure: lastFailure,
    response: lastResponse,
  })
}

function isRepairableAgentError(error: unknown) {
  if (error instanceof z.ZodError) return true
  const message = error instanceof Error ? error.message : String(error)
  return REPAIRABLE_AGENT_ERRORS.some(code => message.includes(code))
}

function trackParsedValue<T>(
  schema: z.ZodType<T>,
  onValue: (value: unknown) => void,
): z.ZodType<T> {
  return new Proxy(schema, {
    get(target, property) {
      if (property === "parse") {
        return (value: unknown, params?: unknown) => {
          onValue(value)
          return (target.parse as any)(value, params)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

function guardCustomEngineResult<TContext>(
  engine: Exclude<AnyReactionEngine<TContext>, { kind: "ekairos.ai" }>,
  output: z.ZodType | undefined,
  onValue: (value: unknown) => void,
): Exclude<AnyReactionEngine<TContext>, { kind: "ekairos.ai" }> {
  return {
    async agent(request) {
      const result = await engine.agent(request)
      if (!result || typeof result !== "object" || !("output" in result)) {
        onValue(result)
        throw new Error("reaction_engine_result_required")
      }
      onValue(result.output)
      if (output) output.parse(result.output)
      else if (typeof result.output !== "string" || !result.output.trim()) {
        throw new Error("reaction_engine_empty_response")
      }
      return result
    },
  }
}

function invalidOutputMessage(value: unknown): ModelMessage {
  return {
    role: "assistant",
    content: [{
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value ?? null),
    }],
  } as ModelMessage
}

function safeJsonSchema(schema: z.ZodType) {
  try {
    return z.toJSONSchema(schema, { target: "draft-7" })
  } catch {
    return { description: "Use the exact Zod validation paths in the repair message." }
  }
}

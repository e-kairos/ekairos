import type { ModelMessage } from "ai"
import {
  normalizePartsForPersistence,
  type ContextPartEnvelope,
} from "@ekairos/events"

import { applyActionResult } from "./context.action-calls.js"
import {
  actionPartsToModelMessages,
  buildAgentSystemPrompt,
} from "./reaction-view.js"
import {
  executeAiSdkAgentRound,
  type ReactionToolChoice,
} from "./reactors/ai-sdk.agent.js"
import {
  isAiEngine,
  type AnyReactionEngine,
  type ReactionEngineActions,
  type ReactionEngineInput,
  type ReactionEngineResult,
  type ReactionToolAction,
} from "./reactor.js"

const RESPOND = "respond"

export async function runReactionEngineAgent<TContext, TOutput>(input: {
  engine: AnyReactionEngine<TContext>
  request: ReactionEngineInput<TContext, TOutput>
}): Promise<ReactionEngineResult<TOutput>> {
  if (!isAiEngine(input.engine)) {
    const result = await input.engine.agent(input.request)
    if (!result || typeof result !== "object" || !("output" in result)) {
      throw new Error("reaction_engine_result_required")
    }
    return Object.freeze({
      output: input.request.output
        ? input.request.output.parse(result.output)
        : result.output as TOutput,
      parts: Object.freeze(normalizePartsForPersistence([...(result.parts ?? [])])),
      ...(result.metadata ? { metadata: Object.freeze({ ...result.metadata }) } : {}),
    })
  }

  return await runAiSdkAgent(input.engine, input.request)
}

async function runAiSdkAgent<TContext, TOutput>(
  engine: Extract<AnyReactionEngine<TContext>, { kind: "ekairos.ai" }>,
  request: ReactionEngineInput<TContext, TOutput>,
): Promise<ReactionEngineResult<TOutput>> {
  const names = createActionNameMap(Object.keys(request.actions))
  const wireActions: Record<string, ReactionToolAction> = {}
  for (const [canonical, action] of Object.entries(request.actions)) {
    const wire = names.canonicalToWire.get(canonical)!
    wireActions[wire] = Object.freeze({
      ...action,
      description: [
        action.description,
        `Canonical action: ${canonical}.`,
      ].filter(Boolean).join(" "),
    })
  }
  if (request.output) {
    if (wireActions[RESPOND]) throw new Error("reaction_action_name_reserved:respond")
    wireActions[RESPOND] = Object.freeze({
      description: "Deliver the final structured result exactly once.",
      input: request.output,
      output: request.output,
      async execute(value) { return value },
    })
  }

  const maxRounds = request.maxRounds ?? engine.maxRounds ?? 20
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new Error("reaction_agent_max_rounds_invalid")
  }
  const system = buildAgentSystemPrompt({
    reactionKey: request.reactionKey,
    instruction: request.instruction,
    hasOutput: Boolean(request.output),
  })
  let messages: ModelMessage[] = [...request.messages]
  const persistedParts: ContextPartEnvelope[] = []
  const roundMetadata: unknown[] = []
  let finalOutput: unknown
  let completed = false
  let lastText = ""

  for (let round = 0; round < maxRounds; round += 1) {
    const toolChoice: ReactionToolChoice = request.output
      ? round === maxRounds - 1
        ? { type: "tool", toolName: RESPOND }
        : "required"
      : "auto"
    const turn = await executeAiSdkAgentRound({
      model: request.model ?? engine.model,
      system,
      messages,
      actions: wireActions,
      toolChoice,
      contextId: request.context.ref.id,
    })
    roundMetadata.push(turn.metadata)
    lastText = turn.text || lastText
    let roundParts = [...turn.parts]
    for (const call of turn.calls) {
      if (call.actionName === RESPOND && request.output) {
        finalOutput = call.input
        completed = true
        roundParts = applyActionResult(roundParts, call, {
          ok: true,
          output: call.input,
        })
        continue
      }

      const canonical = names.wireToCanonical.get(call.actionName)
      const action = canonical ? request.actions[canonical] : undefined
      if (!canonical || !action) {
        roundParts = applyActionResult(roundParts, call, {
          ok: false,
          error: `Unknown action: ${call.actionName}`,
        })
        continue
      }
      try {
        const output = await action.execute(call.input)
        roundParts = applyActionResult(roundParts, call, { ok: true, output })
      } catch (error) {
        roundParts = applyActionResult(roundParts, call, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const canonicalParts = roundParts.map(part => canonicalizePart(part, names.wireToCanonical))
    persistedParts.push(...canonicalParts)
    messages = [
      ...messages,
      ...actionPartsToModelMessages(roundParts, name => name),
      ...(turn.calls.length === 0 && turn.text
        ? [{ role: "assistant", content: [{ type: "text", text: turn.text }] } as ModelMessage]
        : []),
    ]

    if (completed || turn.calls.length === 0) break
  }

  if (request.output && !completed) {
    throw new Error(`reaction_agent_output_not_delivered:${maxRounds}`)
  }
  const output = request.output
    ? request.output.parse(finalOutput)
    : lastText as TOutput
  return Object.freeze({
    output,
    parts: Object.freeze(persistedParts),
    metadata: Object.freeze({ rounds: Object.freeze(roundMetadata) }),
  })
}

function canonicalizePart(
  part: ContextPartEnvelope,
  names: ReadonlyMap<string, string>,
): ContextPartEnvelope {
  if (part.type !== "action") return part
  const canonical = names.get(part.content.actionName)
  if (!canonical) return part
  return {
    ...part,
    content: { ...part.content, actionName: canonical },
  } as ContextPartEnvelope
}

function createActionNameMap(canonicalNames: readonly string[]) {
  const canonicalToWire = new Map<string, string>()
  const wireToCanonical = new Map<string, string>()
  canonicalNames.forEach((canonical, index) => {
    const base = canonical
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || `action_${index}`
    let wire = base
    let suffix = 1
    while (wireToCanonical.has(wire)) wire = `${base}_${suffix++}`
    canonicalToWire.set(canonical, wire)
    wireToCanonical.set(wire, canonical)
  })
  return { canonicalToWire, wireToCanonical }
}

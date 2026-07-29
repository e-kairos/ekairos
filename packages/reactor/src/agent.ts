import type { ModelMessage } from "ai"
import {
  Part,
  normalizePartsForPersistence,
  type ContextEvent,
  type ContextPartEnvelope,
} from "@ekairos/events"

import { applyActionResult } from "./context.action-calls.js"
import { toModelActionName } from "./action-name.js"
import { AGENT_DATASET_ACTION } from "./agent-dataset.js"
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
  type ReactionEngineInput,
  type ReactionEngineResult,
  type ReactionEngineStream,
  type ReactionToolAction,
} from "./reactor.js"

const RESPOND = "respond"

export type ReactionAgentEffectDraft = Readonly<{
  id: string
  type: "context.model" | "context.action"
  payload: unknown
  parts: readonly ContextPartEnvelope[]
  metadata: Readonly<Record<string, unknown>>
}>

export type ReactionAgentEffectJournal = Readonly<{
  id(key: string): string
  record(draft: ReactionAgentEffectDraft): Promise<ContextEvent>
}>

export type ReactionAgentRunResult<TOutput> = Readonly<{
  output: TOutput
  event: ContextEvent<TOutput>
  metadata?: Readonly<Record<string, unknown>>
}>

export async function runReactionEngineAgent<TContext, TOutput>(input: {
  engine: AnyReactionEngine<TContext>
  request: ReactionEngineInput<TContext, TOutput>
  effects: ReactionAgentEffectJournal
}): Promise<ReactionAgentRunResult<TOutput>> {
  if (!isAiEngine(input.engine)) {
    return await runCustomEngine(input.engine, input.request, input.effects)
  }
  return await runAiSdkAgent(input.engine, input.request, input.effects)
}

async function runCustomEngine<TContext, TOutput>(
  engine: Exclude<AnyReactionEngine<TContext>, { kind: "ekairos.ai" }>,
  request: ReactionEngineInput<TContext, TOutput>,
  effects: ReactionAgentEffectJournal,
): Promise<ReactionAgentRunResult<TOutput>> {
  const eventId = effects.id("model:0")
  const stream = bindEventStream(request.stream, eventId)
  await stream?.emit({
    kind: "model.round.started",
    round: 0,
    data: streamEventData(request, "context.model"),
  })
  const result = await engine.agent({ ...request, ...(stream ? { stream } : {}) })
  if (!result || typeof result !== "object" || !("output" in result)) {
    throw new Error("reaction_engine_result_required")
  }
  const output = request.output
    ? request.output.parse(result.output)
    : result.output as TOutput
  const parts = Object.freeze(normalizePartsForPersistence([...(result.parts ?? [])]))
  await stream?.emit({ kind: "model.round.completed", round: 0 })
  const event = await effects.record({
    id: eventId,
    type: "context.model",
    payload: output,
    parts,
    metadata: Object.freeze({
      round: 0,
      ...(result.metadata ?? {}),
    }),
  })
  return Object.freeze({
    output,
    event: event as ContextEvent<TOutput>,
    ...(result.metadata ? { metadata: Object.freeze({ ...result.metadata }) } : {}),
  })
}

async function runAiSdkAgent<TContext, TOutput>(
  engine: Extract<AnyReactionEngine<TContext>, { kind: "ekairos.ai" }>,
  request: ReactionEngineInput<TContext, TOutput>,
  effects: ReactionAgentEffectJournal,
): Promise<ReactionAgentRunResult<TOutput>> {
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
    hasDatasets: Boolean(request.actions[AGENT_DATASET_ACTION]),
  })
  let messages: ModelMessage[] = [...request.messages]
  const roundMetadata: unknown[] = []
  let finalOutput: unknown
  let terminalEvent: ContextEvent | undefined
  let completed = false
  let lastText = ""

  for (let round = 0; round < maxRounds; round += 1) {
    const modelEventId = effects.id(`model:${round}`)
    const modelStream = bindEventStream(request.stream, modelEventId)
    const toolChoice: ReactionToolChoice = request.output
      ? round === maxRounds - 1
        ? { type: "tool", toolName: RESPOND }
        : "required"
      : "auto"
    await modelStream?.emit({
      kind: "model.round.started",
      round,
      data: streamEventData(request, "context.model"),
    })
    const turn = await executeAiSdkAgentRound({
      model: request.model ?? engine.model,
      system,
      messages,
      actions: wireActions,
      toolChoice,
      contextId: request.context.ref.id,
      round,
      ...(modelStream ? { stream: modelStream } : {}),
    })
    roundMetadata.push(turn.metadata)
    lastText = turn.text || lastText

    const respondCalls = turn.calls.filter(call => call.actionName === RESPOND)
    const executableCalls = turn.calls.filter(call => call.actionName !== RESPOND)
    if (respondCalls.length > 1 || (respondCalls.length > 0 && executableCalls.length > 0)) {
      throw new Error("reaction_agent_respond_must_be_terminal")
    }
    if (respondCalls.length === 1 && request.output) {
      finalOutput = request.output.parse(respondCalls[0]!.input)
      completed = true
    }

    const canonicalCalls = turn.calls.map(call => ({
      actionCallId: call.actionCallId,
      actionName: call.actionName === RESPOND
        ? RESPOND
        : names.wireToCanonical.get(call.actionName) ?? call.actionName,
      input: call.input,
    }))
    const modelPayload = completed
      ? finalOutput
      : turn.calls.length === 0
        ? turn.text
        : Object.freeze({
            round,
            text: turn.text,
            actionCalls: Object.freeze(canonicalCalls),
          })
    const modelParts = turn.parts
      .filter(part => part.type !== "action")
      .map(part => canonicalizePart(part, names.wireToCanonical))
    if (completed && finalOutput !== undefined) modelParts.push(Part.json(finalOutput))
    await modelStream?.emit({ kind: "model.round.completed", round })
    terminalEvent = await effects.record({
      id: modelEventId,
      type: "context.model",
      payload: modelPayload,
      parts: Object.freeze(normalizePartsForPersistence(modelParts)),
      metadata: Object.freeze({
        round,
        calls: Object.freeze(canonicalCalls),
        ...turn.metadata,
      }),
    })

    let roundParts = [...turn.parts]
    for (const [callIndex, call] of turn.calls.entries()) {
      const canonicalName = call.actionName === RESPOND
        ? RESPOND
        : names.wireToCanonical.get(call.actionName) ?? call.actionName
      if (call.actionName === RESPOND && request.output) {
        roundParts = applyActionResult(roundParts, call, {
          ok: true,
          output: finalOutput,
        })
        continue
      }

      const actionEventId = effects.id(`action:${round}:${callIndex}`)
      const actionStream = bindEventStream(request.stream, actionEventId)
      await actionStream?.emit({
        kind: "action.started",
        round,
        actionCallId: call.actionCallId,
        actionName: canonicalName,
        input: call.input,
        data: streamEventData(request, "context.action"),
      })
      const started: ContextPartEnvelope = {
        type: "action",
        content: {
          status: "started",
          actionName: canonicalName,
          actionCallId: call.actionCallId,
          input: call.input,
        },
      }
      const canonical = names.wireToCanonical.get(call.actionName)
      const action = canonical ? request.actions[canonical] : undefined
      if (!canonical || !action) {
        const message = `Unknown action: ${call.actionName}`
        roundParts = applyActionResult(roundParts, call, { ok: false, error: message })
        await actionStream?.emit({
          kind: "action.failed",
          round,
          actionCallId: call.actionCallId,
          actionName: canonicalName,
          error: { message },
        })
        await effects.record({
          id: actionEventId,
          type: "context.action",
          payload: { error: message },
          parts: Object.freeze(normalizePartsForPersistence([
            started,
            failedActionPart(canonicalName, call.actionCallId, message),
          ])),
          metadata: Object.freeze({ round, actionCallId: call.actionCallId }),
        })
        continue
      }

      try {
        const output = await action.execute(call.input, request.reactionId, {
          actionCallId: call.actionCallId,
          round,
          callIndex,
        })
        roundParts = applyActionResult(roundParts, call, { ok: true, output })
        await actionStream?.emit({
          kind: "action.completed",
          round,
          actionCallId: call.actionCallId,
          actionName: canonical,
          output,
        })
        await effects.record({
          id: actionEventId,
          type: "context.action",
          payload: output,
          parts: Object.freeze(normalizePartsForPersistence([
            started,
            completedActionPart(canonical, call.actionCallId, output),
          ])),
          metadata: Object.freeze({ round, actionCallId: call.actionCallId }),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        roundParts = applyActionResult(roundParts, call, { ok: false, error: message })
        await actionStream?.emit({
          kind: "action.failed",
          round,
          actionCallId: call.actionCallId,
          actionName: canonical,
          error: { message },
        })
        await effects.record({
          id: actionEventId,
          type: "context.action",
          payload: { error: message },
          parts: Object.freeze(normalizePartsForPersistence([
            started,
            failedActionPart(canonical, call.actionCallId, message),
          ])),
          metadata: Object.freeze({ round, actionCallId: call.actionCallId }),
        })
      }
    }

    messages = [
      ...messages,
      ...actionPartsToModelMessages(
        normalizePartsForPersistence(roundParts),
        name => name,
      ),
      ...(turn.calls.length === 0 && turn.text
        ? [{ role: "assistant", content: [{ type: "text", text: turn.text }] } as ModelMessage]
        : []),
    ]
    if (completed || turn.calls.length === 0) break
  }

  if (request.output && !completed) {
    throw new Error(`reaction_agent_output_not_delivered:${maxRounds}`)
  }
  if (!terminalEvent) throw new Error("reaction_agent_terminal_event_required")
  const output = request.output
    ? request.output.parse(finalOutput)
    : lastText as TOutput
  return Object.freeze({
    output,
    event: terminalEvent as ContextEvent<TOutput>,
    metadata: Object.freeze({ rounds: Object.freeze(roundMetadata) }),
  })
}

function bindEventStream(
  stream: ReactionEngineStream | undefined,
  eventId: string,
): ReactionEngineStream | undefined {
  if (!stream) return undefined
  return Object.freeze({
    ...stream,
    emit: emission => stream.emit({ ...emission, eventId }),
  })
}

function streamEventData<TContext>(
  request: ReactionEngineInput<TContext, unknown>,
  eventType: string,
) {
  return {
    eventType,
    ...(request.trigger.channel ? { channel: request.trigger.channel } : {}),
  }
}

function completedActionPart(
  actionName: string,
  actionCallId: string,
  output: unknown,
): ContextPartEnvelope {
  return {
    type: "action",
    content: { status: "completed", actionName, actionCallId, output },
  }
}

function failedActionPart(
  actionName: string,
  actionCallId: string,
  message: string,
): ContextPartEnvelope {
  return {
    type: "action",
    content: {
      status: "failed",
      actionName,
      actionCallId,
      error: { message },
    },
  }
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
  canonicalNames.forEach(canonical => {
    const wire = toModelActionName(canonical)
    const existing = wireToCanonical.get(wire)
    if (existing && existing !== canonical) {
      throw new Error(`reaction_action_wire_name_collision:${wire}`)
    }
    canonicalToWire.set(canonical, wire)
    wireToCanonical.set(wire, canonical)
  })
  return { canonicalToWire, wireToCanonical }
}

import type { ModelMessage } from "ai"
import {
  normalizePartsForPersistence,
  type ContextPartEnvelope,
} from "@ekairos/events"

import type { ReactionModel, ReactionToolAction } from "../reactor.js"
import {
  actionSpecToAiSdkTool,
  actionsToActionSpecs,
} from "../tools-to-model-tools.js"

export type ReactionToolChoice =
  | "auto"
  | "required"
  | Readonly<{ type: "tool"; toolName: string }>

export async function executeAiSdkAgentRound(input: {
  model: ReactionModel
  system: string
  messages: readonly ModelMessage[]
  actions: Readonly<Record<string, ReactionToolAction>>
  toolChoice: ReactionToolChoice
  contextId: string
}): Promise<{
  parts: readonly ContextPartEnvelope[]
  calls: readonly Readonly<{
    actionCallId: string
    actionName: string
    input: unknown
  }>[]
  text: string
  metadata: Readonly<Record<string, unknown>>
}> {
  const { gateway, jsonSchema, stepCountIs, streamText } = await import("ai")
  const resolvedModel = typeof input.model === "string"
    ? gateway(input.model)
    : await input.model()
  const specs = actionsToActionSpecs(input.actions)
  const tools = Object.fromEntries(
    Object.entries(specs).map(([name, spec]) => [
      name,
      actionSpecToAiSdkTool(name, spec, jsonSchema),
    ]),
  )
  const startedAt = Date.now()
  const result: any = streamText({
    model: resolvedModel,
    system: input.system,
    messages: input.messages as ModelMessage[],
    tools: tools as any,
    toolChoice: input.toolChoice,
    stopWhen: stepCountIs(1),
    providerOptions: { openai: { promptCacheKey: input.contextId } },
  })

  const [text, toolCalls, usage, providerMetadata] = await Promise.all([
    Promise.resolve(result.text).catch(() => ""),
    Promise.resolve(result.toolCalls).catch(() => []),
    Promise.resolve(result.usage).catch(() => undefined),
    Promise.resolve(result.providerMetadata ?? result.experimental_providerMetadata)
      .catch(() => undefined),
  ])
  const calls = (Array.isArray(toolCalls) ? toolCalls : []).map((call: any) => ({
    actionCallId: String(call.toolCallId ?? call.id ?? globalThis.crypto.randomUUID()),
    actionName: String(call.toolName ?? call.name ?? ""),
    input: call.input ?? call.args,
  })).filter((call: { actionName: string }) => call.actionName.length > 0)
  const parts = normalizePartsForPersistence([
    ...(typeof text === "string" && text.trim()
      ? [{ type: "message", content: { text } }]
      : []),
    ...calls.map((call: any) => ({
      type: "action",
      content: {
        status: "started",
        actionName: call.actionName,
        actionCallId: call.actionCallId,
        input: call.input,
      },
    })),
  ])

  return Object.freeze({
    parts: Object.freeze(parts),
    calls: Object.freeze(calls),
    text: typeof text === "string" ? text : "",
    metadata: Object.freeze({
      latencyMs: Date.now() - startedAt,
      usage: jsonSafe(usage),
      providerMetadata: jsonSafe(providerMetadata),
    }),
  })
}

function jsonSafe(value: unknown) {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

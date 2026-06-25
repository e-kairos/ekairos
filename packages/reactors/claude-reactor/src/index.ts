import {
  OUTPUT_ITEM_TYPE,
  type ContextItem,
} from "@ekairos/events"
import type {
  ContextReactionResult,
  ContextReactor,
  ContextReactorParams,
} from "@ekairos/reactor/context"
import type { ContextEnvironment } from "@ekairos/reactor/runtime"

type AnyRecord = Record<string, unknown>

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function asRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== "object") return {}
  return value as AnyRecord
}

export type ClaudeTurnResult = {
  text: string
  metadata?: Record<string, unknown>
}

export type ClaudeExecuteTurnParams = {
  /** stored context content */
  context: AnyRecord
  /** engine-expanded conversation items */
  events: ContextItem[]
  triggerEvent: ContextItem
  /** narrative/system prompt resolved by the context */
  systemPrompt: string
  contextId: string
  executionId: string
  stepId: string
  iteration: number
  writable?: WritableStream<unknown>
  contextStepStream?: WritableStream<string>
}

export type CreateClaudeReactorOptions<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
> = {
  executeTurn: (params: ClaudeExecuteTurnParams) => Promise<ClaudeTurnResult>
}

/**
 * Claude reactor for the @ekairos/events context engine.
 *
 * Integrators provide `executeTurn` (Claude API, Claude Agent SDK, or the
 * local Claude Code CLI in headless print mode) and Context keeps
 * durability, persistence and step lifecycle.
 */
export function createClaudeReactor<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
>(
  options: CreateClaudeReactorOptions<Context, Env>,
): ContextReactor<Context, Env> {
  return async (
    params: ContextReactorParams<Context, Env>,
  ): Promise<ContextReactionResult> => {
    const context = asRecord(params.context.content)
    const turn = await options.executeTurn({
      context,
      events: params.events,
      triggerEvent: params.triggerEvent,
      systemPrompt: asString(params.systemPrompt),
      contextId: params.contextId,
      executionId: params.executionId,
      stepId: params.stepId,
      iteration: params.iteration,
      writable: params.writable,
      contextStepStream: params.contextStepStream,
    })

    const assistantEvent: ContextItem = {
      id: params.eventId,
      type: OUTPUT_ITEM_TYPE,
      channel: "web",
      createdAt: new Date().toISOString(),
      status: "completed",
      content: {
        parts: [{ type: "text", text: asString(turn.text).trim() }],
      },
    }

    return {
      assistantEvent,
      actionRequests: [],
      messagesForModel: [],
      llm: {
        provider: "anthropic",
        model: "claude",
        rawProviderMetadata: turn.metadata,
      },
    }
  }
}

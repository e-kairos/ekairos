import { Context, type ContextRuntimeWithDomainUse } from "@ekairos/context"
import { Events, type DomainEventItem } from "@ekairos/events"
import {
  type ReactionDefinition,
  type ReactionEffect,
} from "@ekairos/reactor"

import type { ChannelInbound } from "./platforms.js"

export type ChannelAgentRuntime = ContextRuntimeWithDomainUse

type AnyReactionDefinition = ReactionDefinition<any, any, any, any>

export type ReactionEffectOf<Definition extends AnyReactionDefinition> =
  Definition extends ReactionDefinition<any, any, any, infer Effect>
    ? Effect
    : never

type ReactionContextOf<Definition extends AnyReactionDefinition> =
  Definition extends ReactionDefinition<infer ContextContent, any, any, any>
    ? ContextContent
    : never

type ReactionDraftOf<Definition extends AnyReactionDefinition> =
  ReturnType<Definition["trigger"]>

type Awaitable<Value> = Value | Promise<Value>

export type BindReactionOptions<Definition extends AnyReactionDefinition> = Readonly<{
  runtime: ChannelAgentRuntime
  reaction: Definition
  event: (inbound: ChannelInbound) => Awaitable<ReactionDraftOf<Definition>>
  replyText?: (
    effect: ReactionEffectOf<Definition>,
    inbound: ChannelInbound,
  ) => Awaitable<string | null>
}>

export function bindReaction<Definition extends AnyReactionDefinition>(
  options: BindReactionOptions<Definition>,
): (inbound: ChannelInbound) => Promise<string | null> {
  return async (inbound) => {
    const draft = await options.event(inbound)
    const event = await Events(options.runtime).emit(draft, {
      id: freshId(),
      channel: inbound.channel,
      createdAt: inbound.message.createdAt || new Date(),
      contextId: inbound.contextId,
    })
    await inbound.attachEvent(event.id)

    const context = await Context(options.runtime).get<ReactionContextOf<Definition>>({
      id: inbound.contextId,
    })
    if (!context) {
      throw new Error(`channel_reaction_context_not_found:${inbound.contextId}`)
    }

    const effect = await context.react(event, options.reaction)
    if (options.replyText) return await options.replyText(effect, inbound)
    return defaultReplyText(effect)
  }
}

function freshId(): string {
  return globalThis.crypto.randomUUID()
}

function defaultReplyText(effect: ReactionEffect): string | null {
  const effects = Array.isArray(effect) ? effect : [effect]
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const text = replyTextFromEvent(effects[index] as DomainEventItem)
    if (text) return text
  }
  return null
}

function replyTextFromEvent(effect: DomainEventItem): string | null {
  const payload = effect.payload
  if (typeof payload === "string") return normalizedText(payload)
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null

  const response = payload as Record<string, unknown>
  if (typeof response.text === "string") return normalizedText(response.text)
  if (typeof response.reply === "string") return normalizedText(response.reply)
  return null
}

function normalizedText(value: string): string | null {
  const text = value.trim()
  return text.length > 0 ? text : null
}

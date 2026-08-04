import type { ContextEvent } from "../../packages/events/src/index.ts"

export type ReactionChatInput = Readonly<{
  input: unknown
  contextKey: string
}>

export type ReactionChatRun = Readonly<{
  contextId: string
  sessionId: string
  returnValue: Promise<ContextEvent>
}>

export type ReactionChatModule = Readonly<{
  react(input: ReactionChatInput): ReactionChatRun | Promise<ReactionChatRun>
}>

import type { ContextReactionForUI } from "./react.types.js"

export function selectReactionsForStreaming(
  reactions: readonly ContextReactionForUI[],
  reactionIds: readonly string[] | undefined,
): readonly ContextReactionForUI[] {
  if (reactionIds === undefined) return reactions
  const selected = new Set(reactionIds)
  return reactions.filter(reaction =>
    reaction.status === "running" || selected.has(reaction.id))
}

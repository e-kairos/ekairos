export { agentDomain } from "./schema.js"

/**
 * InstaQL query for the durable thread association and its causal timeline.
 * Writes belong to domain Actions and Reactions; this package only owns the
 * agent_threads projection used by conversational UIs.
 */
export function buildThreadTimelineQuery(threadKey: string) {
  return {
    agent_threads: {
      $: { where: { key: threadKey } },
      context: {
        events: {
          $: { order: { createdAt: "asc" as const } },
          eventParts: { $: { order: { index: "asc" as const } } },
          channelMessages: {},
        },
        channelMessages: {},
      },
    },
  }
}

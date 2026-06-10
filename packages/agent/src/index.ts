export { agentDomain } from "./schema.js";

export {
  createAssistantItem,
  createTextInputItem,
  generateAgentId,
  getItemReasoning,
  getItemText,
  type AgentContextMeta,
  type AgentItem,
  type AgentItemChannel,
} from "./items.js";

export type {
  ThreadChunk,
  ThreadMeta,
  ThreadSendInput,
  ThreadSnapshot,
  ThreadTransport,
  ThreadTransportEvent,
  ThreadTurnStatus,
} from "./transport.js";

export {
  MemoryAgentStore,
  type AgentStore,
  type ThreadIdentifier,
  type ThreadRecord,
  type ThreadStore,
} from "./store.js";

export {
  type AgentReactionParams,
  type AgentReactionResult,
  type AgentReactor,
} from "./reactor.js";

export { createThread, type Thread, type ThreadOptions } from "./thread.js";

/**
 * InstantDB query for a thread timeline: the thread, its context items in
 * order, and the channel messages (email, whatsapp, ...) linked to each item
 * and to the context. Use it from `db.useQuery` in db-bound deployments.
 */
export function buildThreadTimelineQuery(threadKey: string) {
  return {
    agent_threads: {
      $: { where: { key: threadKey } },
      context: {
        items: {
          $: { order: { createdAt: "asc" as const } },
          channelMessages: {},
        },
        channelMessages: {},
      },
    },
  };
}

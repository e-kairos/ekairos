import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { channelDomain } from "@ekairos/channel/schema"

/**
 * A thread is a durable conversational projection over one Context. Domain
 * Events and Reactions remain application-owned; this domain only owns the
 * stable thread-to-context association used by channel-aware UIs.
 */
const entities = {
  agent_threads: i.entity({
    key: i.string().optional().unique().indexed(),
    title: i.string().optional(),
    status: i.string().optional().indexed(),
    metadata: i.json().optional(),
    createdAt: i.date().indexed(),
    updatedAt: i.date().optional(),
  }),
} as const

const links = {
  agentThreadsContext: {
    forward: { on: "agent_threads", has: "one", label: "context" },
    reverse: { on: "context_contexts", has: "one", label: "thread" },
  },
} as const

const rooms = {} as const

export const agentDomain = domain("agent")
  .includes(channelDomain)
  .withSchema({ entities, links, rooms })

import { i } from "@instantdb/core";
import { domain, type DomainSchemaResult } from "@ekairos/domain";
import { channelDomain } from "@ekairos/channel/schema";

/**
 * Agent domain. The schema is the starting point: a thread is the unit an
 * application talks to — a thin indirection that owns the agent's context.
 * Everything else (items, executions, steps, parts) is the context itself
 * (@ekairos/events). Channel messages (@ekairos/channel) hang off the same
 * context so a thread's timeline can span web, email, whatsapp, ...
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
} as const;

const links = {
  agent_threadsContext: {
    forward: { on: "agent_threads", has: "one", label: "context" },
    reverse: { on: "event_contexts", has: "one", label: "thread" },
  },
} as const;

const rooms = {} as const;

export const agentDomain = domain("agent")
  .includes(channelDomain)
  .withSchema({
    entities,
    links,
    rooms,
  }) as unknown as DomainSchemaResult<
    typeof entities,
    typeof links,
    typeof rooms,
    {},
    "agent",
    "agent"
  >;

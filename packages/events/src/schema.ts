import { domain } from "@ekairos/domain"
import { i } from "@instantdb/core"

const contextSchema = {
  entities: {
    context_contexts: i.entity({
      key: i.string().optional().unique().indexed(),
      name: i.string().optional(),
      content: i.any().optional(),
      previous: i.any().optional(),
      createdAt: i.date().indexed(),
      updatedAt: i.date().optional().indexed(),
    }),
    context_sessions: i.entity({
      definition: i.string().indexed(),
      status: i.string().indexed(),
      sandboxId: i.string().optional().indexed(),
      workflowRunId: i.string().optional().indexed(),
      error: i.any().optional(),
      createdAt: i.date().indexed(),
      updatedAt: i.date().optional().indexed(),
    }),
    context_events: i.entity({
      type: i.string().indexed(),
      domain: i.string().optional().indexed(),
      name: i.string().optional().indexed(),
      channel: i.string().optional().indexed(),
      payload: i.any().optional(),
      links: i.json().optional(),
      physicalLinks: i.json().optional(),
      metadata: i.json().optional(),
      createdAt: i.date().indexed(),
    }),
    context_reactions: i.entity({
      type: i.string().indexed(),
      status: i.string().indexed(),
      position: i.number().indexed(),
      depth: i.number().indexed(),
      causeIds: i.json(),
      effectIds: i.json(),
      instruction: i.string().optional(),
      error: i.any().optional(),
      createdAt: i.date().indexed(),
      updatedAt: i.date().optional().indexed(),
    }),
    context_eventParts: i.entity({
      key: i.string().unique().indexed(),
      index: i.number().indexed(),
      type: i.string().indexed(),
      content: i.json(),
      metadata: i.json().optional(),
      createdAt: i.date().indexed(),
      updatedAt: i.date().optional().indexed(),
    }),
  },
  links: {
    contextEventContext: {
      forward: { on: "context_events", has: "one", label: "context" },
      reverse: { on: "context_contexts", has: "many", label: "events" },
    },
    contextSessionContext: {
      forward: { on: "context_sessions", has: "one", label: "context" },
      reverse: { on: "context_contexts", has: "many", label: "sessions" },
    },
    contextCurrentSession: {
      forward: { on: "context_contexts", has: "one", label: "currentSession" },
      reverse: { on: "context_sessions", has: "one", label: "currentOf" },
    },
    contextSessionParent: {
      forward: { on: "context_sessions", has: "one", label: "parent" },
      reverse: { on: "context_sessions", has: "many", label: "children" },
    },
    contextSessionTrigger: {
      forward: { on: "context_sessions", has: "one", label: "trigger" },
      reverse: { on: "context_events", has: "many", label: "triggeredSessions" },
    },
    contextSessionRootReaction: {
      forward: { on: "context_sessions", has: "one", label: "rootReaction" },
      reverse: { on: "context_reactions", has: "one", label: "rootOf" },
    },
    contextReactionSession: {
      forward: { on: "context_reactions", has: "one", label: "session" },
      reverse: { on: "context_sessions", has: "many", label: "reactions" },
    },
    contextReactionParent: {
      forward: { on: "context_reactions", has: "one", label: "parent" },
      reverse: { on: "context_reactions", has: "many", label: "children" },
    },
    contextReactionCauses: {
      forward: { on: "context_reactions", has: "many", label: "causes" },
      reverse: { on: "context_events", has: "many", label: "causedReactions" },
    },
    contextReactionEffects: {
      forward: { on: "context_reactions", has: "many", label: "effects" },
      reverse: { on: "context_events", has: "many", label: "effectOf" },
    },
    contextEventPartsEvent: {
      forward: { on: "context_eventParts", has: "one", label: "event" },
      reverse: { on: "context_events", has: "many", label: "eventParts" },
    },
  },
  rooms: {},
} as const

export const contextDomain = domain("context").withSchema(contextSchema)

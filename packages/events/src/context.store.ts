import type { DomainEventPhysicalLink } from "./domain-event.js"

export type ContextIdentifier =
  | Readonly<{ id: string; key?: never }>
  | Readonly<{ key: string; id?: never }>

export type StoredContext<Content = unknown> = Readonly<{
  id: string
  key: string | null
  name?: string | null
  content: Content | null
  previous?: Content
  createdAt: Date
  updatedAt?: Date
}>

export type ContextEventPart = Readonly<{
  id: string
  key: string
  index: number
  type: string
  content: unknown
  metadata?: Readonly<Record<string, unknown>>
  createdAt: Date
  updatedAt?: Date
}>

export type ContextEvent<Payload = unknown> = Readonly<{
  id: string
  type: string
  createdAt: Date
  contextId?: string
  domain?: string
  name?: string
  channel?: string
  payload: Payload
  links: Readonly<Record<string, string | readonly string[]>>
  physicalLinks: Readonly<Record<string, DomainEventPhysicalLink>>
  metadata: Readonly<Record<string, unknown>>
  eventParts: readonly ContextEventPart[]
}>

export type DomainEventItem<Payload = unknown> = ContextEvent<Payload> & Readonly<{
  domain: string
  name: string
}>

export type SessionStatus = "running" | "completed" | "failed"
export type ReactionStatus = "running" | "completed" | "failed"

export type ContextSession = Readonly<{
  id: string
  contextId: string
  definition: string
  triggerId: string
  rootReactionId: string
  status: SessionStatus
  parentSessionId?: string
  parentReactionId?: string
  sandboxId?: string
  workflowRunId?: string
  error?: unknown
  createdAt: Date
  updatedAt?: Date
}>

export type ContextReaction = Readonly<{
  id: string
  sessionId: string
  type: string
  status: ReactionStatus
  position: number
  depth: number
  causeIds: readonly string[]
  effectIds: readonly string[]
  parentReactionId?: string
  instruction?: string
  streamId?: string
  streamClientId?: string
  streamStartedAt?: Date
  streamFinishedAt?: Date
  streamError?: string
  error?: unknown
  createdAt: Date
  updatedAt?: Date
}>

export type SaveContextEventInput<Payload = unknown> = Omit<
  ContextEvent<Payload>,
  "eventParts"
> & Readonly<{
  eventParts?: readonly Omit<ContextEventPart, "id" | "key" | "createdAt">[]
}>

export interface ContextStore {
  getOrCreateContext<Content>(identifier: ContextIdentifier): Promise<StoredContext<Content>>
  getContext<Content>(identifier: ContextIdentifier): Promise<StoredContext<Content> | null>
  updateContextContent<Content>(
    identifier: ContextIdentifier,
    content: Content,
  ): Promise<StoredContext<Content>>

  saveEvent<Payload>(
    event: SaveContextEventInput<Payload>,
    origin?: ContextIdentifier,
  ): Promise<ContextEvent<Payload>>
  getEvent<Payload = unknown>(eventId: string): Promise<ContextEvent<Payload> | null>
  getEvents(identifier: ContextIdentifier): Promise<ContextEvent[]>
  saveEventParts(
    eventId: string,
    parts: readonly Omit<ContextEventPart, "id" | "key" | "createdAt">[],
  ): Promise<readonly ContextEventPart[]>

  openSession(input: Readonly<{
    id: string
    rootReactionId: string
    contextId: string
    definition: string
    triggerId: string
    parentSessionId?: string
    parentReactionId?: string
    sandboxId?: string
    workflowRunId?: string
    createdAt?: Date
  }>): Promise<ContextSession>
  getSession(sessionId: string): Promise<ContextSession | null>
  completeSession(
    sessionId: string,
    status: Exclude<SessionStatus, "running">,
    error?: unknown,
  ): Promise<void>

  openReaction(input: Readonly<{
    id: string
    sessionId: string
    type: string
    position: number
    depth: number
    causeIds: readonly string[]
    parentReactionId?: string
    instruction?: string
    createdAt?: Date
  }>): Promise<ContextReaction>
  getReaction(reactionId: string): Promise<ContextReaction | null>
  appendReactionEffect(
    reactionId: string,
    effectId: string,
  ): Promise<ContextReaction>
  attachReactionStream(
    reactionId: string,
    stream: Readonly<{
      streamId: string
      clientId: string
      startedAt?: Date
    }>,
  ): Promise<ContextReaction>
  finishReactionStream(
    reactionId: string,
    result?: Readonly<{
      finishedAt?: Date
      error?: string
    }>,
  ): Promise<ContextReaction>
  completeReaction(
    reactionId: string,
    status: Exclude<ReactionStatus, "running">,
    effectIds?: readonly string[],
    error?: unknown,
  ): Promise<void>
}

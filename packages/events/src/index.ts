export { contextDomain } from "./schema.js"
export { contextEventFilesPhysicalLink } from "./schema.js"

export {
  Events,
  EventsClient,
  EventBuilder,
  Part,
} from "./event.builder.js"
export type {
  EventCreateInput,
  EventQueryInput,
  EventQueryResult,
} from "./event.builder.js"

export { emitDomainEvent, isDomainEventItem } from "./domain-event.js"
export type {
  DomainEventDraftLike,
  DomainEventEnvelope,
  DomainEventPhysicalLink,
} from "./domain-event.js"

export {
  ContextHandle,
  createContextHandle,
  getContextHandle,
} from "./context.handle.js"
export type { ContextHandleCreateParams } from "./context.handle.js"

export type {
  ContextEvent,
  ContextEventPart,
  ContextIdentifier,
  ContextReaction,
  ContextSession,
  ContextStore,
  DomainEventItem,
  ReactionStatus,
  SaveContextEventInput,
  SessionStatus,
  StoredContext,
} from "./context.store.js"

export { getContextRuntimeServices } from "./context.runtime.js"
export type {
  ContextRuntime,
  ContextRuntimeForDomain,
  ContextRuntimeHandleForDomain,
  ContextRuntimeServiceHandle,
  ContextRuntimeServices,
} from "./context.runtime.js"

export type { ContextSandboxHandle } from "./context.sandbox.js"

export {
  reactorMetadataSchema,
  contextPartSchema,
  contextPartEnvelopeSchema,
  contextPartContentSchema,
  contextMessagePartSchema,
  contextReasoningPartSchema,
  contextSourcePartSchema,
  contextActionPartSchema,
  contextEnginePartSchema,
  createContextPartSchema,
  parseContextPart,
  isContextPartEnvelope,
  parseContextPartEnvelope,
  normalizePartsForPersistence,
} from "./context.parts.js"
export type {
  ReactorMetadata,
  ContextEnginePart,
  ContextActionPart,
  ContextActionStartedPart,
  ContextActionCompletedPart,
  ContextActionFailedPart,
  ContextPartActionMap,
  ContextPart,
  ContextPartEnvelope,
  ContextPartContent,
  ContextInlineContent,
} from "./context.parts.js"

export { uuidV5 } from "./context.part-identity.js"

export {
  REACTION_STREAM_VERSION,
  consumeReactionStream,
  createReactionStreamChunk,
  encodeReactionStreamChunk,
  parseReactionStreamChunk,
  reduceReactionStream,
  validateReactionStreamChunk,
} from "./context.reaction-stream.js"
export type {
  ReactionStreamChunk,
  ReactionStreamChunkInput,
  ReactionStreamChunkKind,
  ReactionStreamProjection,
} from "./context.reaction-stream.js"

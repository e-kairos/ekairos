export { contextDomain, eventsDomain, reactionDomain } from "./schema.js"

export {
  Events,
  EventsClient,
  EventBuilder,
  Part,
} from "./event.builder.js"

export type {
  EventBuilderStepInput,
  EventCreateInput,
} from "./event.builder.js"

export type {
  ContextStore,
  ContextIdentifier,
  StoredContext,
  ContextResource,
  ContextResourceBase,
  ContextFileResource,
  ContextLinkResource,
  ContextRepositoryResource,
  ContextDatasetResource,
  ContextExternalResource,
  StoredContextResource,
  ContextItem,
  ContextStep,
  ContextExecution,
} from "./context.store.js"

export {
  coerceContextRuntime,
} from "./context.config.js"

export type {
  ContextEnvironment,
  ContextRuntime as ContextRuntimeServicesRuntime,
} from "./context.config.js"

export {
  getContextRuntimeServices,
} from "./context.runtime.js"

export type {
  ContextRuntime,
  ContextRuntimeForDomain,
  ContextRuntimeHandleForDomain,
  ContextRuntimeServiceHandle,
  ContextRuntimeServices,
} from "./context.runtime.js"

export {
  ContextHandle,
  createContextHandle,
  getContextHandle,
} from "./context.handle.js"

export type {
  ContextHandleCreateParams,
  ContextHandleEventParams,
  ContextHandleOpenExecutionParams,
  ContextHandleOpenExecutionResult,
  ContextHandlePrepareLocalOptions,
  ContextHandlePrepareExecutionLocalOptions,
  ContextHandlePreparePartLocalOptions,
  ContextHandlePrepareSandboxOptions,
  ContextHandlePrepareExecutionSandboxOptions,
  ContextHandlePreparePartSandboxOptions,
} from "./context.handle.js"

export {
  CONTEXT_LOCAL_SEGMENT_MAX_LENGTH,
  getContextExecutionLocalRoot,
  getContextLocalRoot,
  getContextPartLocalRoot,
  getContextResourceLocalRoot,
  getContextStepLocalRoot,
  prepareContextLocal,
  prepareExecutionLocal,
  prepareStepPartLocal,
  safeContextLocalFilename,
  safeContextLocalSegment,
  safeContextResourceLocalSegment,
} from "./context.local.js"

export {
  prepareContextSandbox,
  prepareExecutionSandbox,
  prepareStepPartSandbox,
} from "./context.sandbox.js"

export type {
  ContextLocalFileMaterial,
  ContextLocalFileReader,
  ContextLocalRepositoryMaterializer,
  PreparedContextLocal,
  PreparedContextResource,
  PreparedContextResourceFile,
  PreparedExecutionLocal,
  PreparedStepPartLocal,
  PrepareContextLocalOptions,
  PrepareExecutionLocalOptions,
  PrepareStepPartLocalOptions,
} from "./context.local.js"

export type {
  ContextSandboxRepositoryMaterializer,
  ContextSandboxSession,
  PrepareContextSandboxOptions,
  PrepareExecutionSandboxOptions,
  PrepareStepPartSandboxOptions,
} from "./context.sandbox.js"

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

export {
  INPUT_ITEM_TYPE,
  INPUT_TEXT_ITEM_TYPE,
  OUTPUT_ITEM_TYPE,
  WEB_CHANNEL,
  AGENT_CHANNEL,
  EMAIL_CHANNEL,
  createUserItemFromUIMessages,
  createAssistantItemFromUIMessages,
  convertToUIMessage,
  convertItemToModelMessages,
  convertItemsToModelMessages,
  convertModelMessageToItem,
  isContextOutputPart,
  normalizeContextOutputPart,
  type ResponseMessage,
  type ContextOutputPart,
  type ContextOutputContentPart,
} from "./context.events.js"

export {
  CONTEXT_STATUSES,
  EXECUTION_STATUSES,
  STEP_STATUSES,
  ITEM_STATUSES,
  ITEM_TYPES,
  CHANNELS,
  TRACE_EVENT_KINDS,
  CONTEXT_STREAM_CHUNK_TYPES,
  STREAM_LIFECYCLE_CHUNK_TYPES,
  STREAM_TEXT_CHUNK_TYPES,
  STREAM_REASONING_CHUNK_TYPES,
  STREAM_ACTION_CHUNK_TYPES,
  STREAM_SOURCE_CHUNK_TYPES,
  STREAM_METADATA_CHUNK_TYPES,
  STREAM_ERROR_CHUNK_TYPES,
  CONTEXT_TRANSITIONS,
  EXECUTION_TRANSITIONS,
  STEP_TRANSITIONS,
  ITEM_TRANSITIONS,
  canContextTransition,
  canExecutionTransition,
  canStepTransition,
  canItemTransition,
  assertContextTransition,
  assertExecutionTransition,
  assertStepTransition,
  assertItemTransition,
  isContextStreamChunkType,
  assertContextPartKey,
} from "./context.contract.js"

export type {
  Transition,
  ContextStatus,
  ExecutionStatus,
  StepStatus,
  ItemStatus,
  ItemType,
  Channel,
  TraceEventKind,
  ContextStreamChunkType,
  ContextTransition,
  ExecutionTransition,
  StepTransition,
  ItemTransition,
} from "./context.contract.js"

export {
  parseContextStreamEvent,
  assertContextStreamTransitions,
  validateContextStreamTimeline,
} from "./context.stream.js"

export type {
  ContextStreamEvent,
  ContextCreatedEvent,
  ContextResolvedEvent,
  ContextStatusChangedEvent,
  ContextContentUpdatedEvent,
  ContextDefinitionUpdatedEvent,
  ContextResourcesUpdatedEvent,
  ExecutionCreatedEvent,
  ExecutionCompletedEvent,
  ExecutionFailedEvent,
  ItemCreatedEvent,
  ItemUpdatedEvent,
  ItemPendingEvent,
  ItemCompletedEvent,
  StepCreatedEvent,
  StepUpdatedEvent,
  StepCompletedEvent,
  StepFailedEvent,
  PartCreatedEvent,
  PartUpdatedEvent,
  ChunkEmittedEvent,
} from "./context.stream.js"

export {
  CONTEXT_STEP_STREAM_VERSION,
  createContextStepStreamChunk,
  validateContextStepStreamChunk,
  parseContextStepStreamChunk,
  encodeContextStepStreamChunk,
  contextStreamByteLength,
} from "./context.step-stream.js"

export type {
  ContextStepStreamChunk,
  ContextStepStreamChunkValidationOptions,
} from "./context.step-stream.js"

export {
  CONTEXT_PART_ID_NAMESPACE,
  CONTEXT_PART_UUID_RE,
  CONTEXT_STREAM_PART_TYPES,
  assertValidContextPartChunkIdentity,
  resolveContextPartChunkDescriptor,
  resolveContextPartChunkIdentity,
  resolveContextPartId,
  resolveContextStreamPartSlot,
  resolveContextStreamPartType,
  uuidV5,
} from "./context.part-identity.js"

export type {
  ContextPartChunkDescriptor,
  ContextPartChunkIdentity,
  ContextPartChunkIdentityInput,
  ContextPartChunkValidationInput,
  ContextStreamPartSlot,
  ContextStreamPartType,
} from "./context.part-identity.js"

export type {
  WireDate,
  ContextMirrorContext,
  ContextMirrorExecution,
  ContextMirrorWrite,
  ContextMirrorRequest,
} from "./mirror.js"

import type { ModelMessage } from "ai"
import type {
  ContextStatus,
  ExecutionStatus,
  StepStatus,
  ItemStatus,
  ItemType,
  Channel,
} from "./context.contract.js"

export type ContextIdentifier = { id: string; key?: never } | { key: string; id?: never }

export type { ContextStatus } from "./context.contract.js"

export type ContextResourceBase = {
  key: string
  type: string
  name: string
  description: string
  role?: string | null
  metadata?: Record<string, unknown> | null
}

export type ContextFileResource = ContextResourceBase & {
  type: "file"
  fileId?: string
  documentId?: string
  url?: string
  filename?: string
  mediaType?: string
  size?: number
}

export type ContextLinkResource = ContextResourceBase & {
  type: "link"
  url: string
}

export type ContextRepositoryResource = ContextResourceBase & {
  type: "repository"
  provider?: string
  repository: string
  ref?: string
  paths?: string[]
  commitSha?: string
}

export type ContextDatasetResource = ContextResourceBase & {
  type: "dataset"
  datasetId: string
}

export type ContextExternalResource = ContextResourceBase & {
  type: "external"
  uri?: string
}

export type ContextResource =
  | ContextFileResource
  | ContextLinkResource
  | ContextRepositoryResource
  | ContextDatasetResource
  | ContextExternalResource
  | (ContextResourceBase & Record<string, unknown>)

export type StoredContextResource = ContextResource & {
  id?: string
  storageKey?: string
  createdAt?: Date
  updatedAt?: Date
}

export type StoredContext<Context> = {
  id: string
  key: string | null
  name?: string | null
  status: ContextStatus
  createdAt: Date
  updatedAt?: Date
  content: Context | null
  description?: string | null
  goal?: string | null
  resources?: StoredContextResource[] | null
  reactor?: { kind: string; state?: Record<string, unknown> | null } | null
}

export type ContextItem = {
  id: string
  type: ItemType
  channel: Channel
  createdAt: string
  status?: ItemStatus
  content: {
    /**
     * Deprecated as the source of truth for output items.
     * The engine maintains this field as a compatibility mirror, but
     * step-level `event_parts` should be used for replay and inspection.
     */
    parts?: unknown[]
    [key: string]: unknown
  }
}

export type ContextStep = {
  id: string
  createdAt: Date
  updatedAt?: Date
  status: StepStatus
  iteration: number
  errorText?: string
}

export type ContextExecution = {
  id: string
  status: ExecutionStatus
}

export interface ContextStore {
  getOrCreateContext<C>(contextIdentifier: ContextIdentifier | null): Promise<StoredContext<C>>
  getContext<C>(contextIdentifier: ContextIdentifier): Promise<StoredContext<C> | null>
  updateContextContent<C>(contextIdentifier: ContextIdentifier, content: C): Promise<StoredContext<C>>
  updateContextDefinition<C>(
    contextIdentifier: ContextIdentifier,
    definition: { description?: string | null; goal?: string | null },
  ): Promise<StoredContext<C>>
  upsertContextResources(
    contextIdentifier: ContextIdentifier,
    resources: ContextResource[],
  ): Promise<StoredContextResource[]>
  getContextResources(contextIdentifier: ContextIdentifier): Promise<StoredContextResource[]>
  updateContextReactor<C>(
    contextIdentifier: ContextIdentifier,
    reactor: { kind: string; state?: Record<string, unknown> | null },
  ): Promise<StoredContext<C>>
  updateContextStatus(contextIdentifier: ContextIdentifier, status: ContextStatus): Promise<void>

  saveEvent(item: ContextItem): Promise<ContextItem>
  saveItem(contextIdentifier: ContextIdentifier, item: ContextItem): Promise<ContextItem>
  updateItem(itemId: string, item: ContextItem): Promise<ContextItem>
  getItem(itemId: string): Promise<ContextItem | null>
  getItems(contextIdentifier: ContextIdentifier): Promise<ContextItem[]>

  createExecution(
    contextIdentifier: ContextIdentifier,
    triggerEventId: string,
    reactionEventId: string,
  ): Promise<{ id: string }>

  completeExecution(
    contextIdentifier: ContextIdentifier,
    executionId: string,
    status: Exclude<ExecutionStatus, "executing">,
  ): Promise<void>

  createStep(params: {
    executionId: string
    iteration: number
  }): Promise<{ id: string }>

  updateStep(
    stepId: string,
    patch: Partial<
      Pick<
        ContextStep,
        | "status"
        | "errorText"
        | "updatedAt"
      >
    >,
  ): Promise<void>

  saveStepParts(params: { stepId: string; parts: any[] }): Promise<void>

  itemsToModelMessages(items: ContextItem[]): Promise<ModelMessage[]>
}

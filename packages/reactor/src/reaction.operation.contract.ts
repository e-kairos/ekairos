import type { DomainActionRegistration } from "@ekairos/domain"
import { getDomainActionBinding } from "@ekairos/domain/internal"
import type {
  ContextEvent,
  ContextRuntimeServiceHandle,
  DomainEventDraftLike,
} from "@ekairos/events"

import type {
  DatasetAdapterProvider,
  DatasetAdapterSource,
} from "./dataset-adapter.js"
import type {
  AnyReactionEngine,
  ReactionModel,
  ReactorInitialContext,
  ReactorShellRunInput,
  ReactorStoreFilesInput,
} from "./reactor.js"
import type { ReactorPath } from "./workspace-path.js"

type AnyDomainAction = DomainActionRegistration<any, any, any, any>

export type ReactionOperationActionRef = Readonly<{
  id: string
  boundInput: Readonly<Record<string, unknown>>
}>

export type ReactionGitInput =
  | Readonly<{
      operation: "clone"
      key: string
      url: string
      ref?: string
      depth?: number
    }>
  | Readonly<{
      operation: "commit"
      path: ReactorPath
      message: string
      all?: boolean
      authorName?: string
      authorEmail?: string
    }>
  | Readonly<{
      operation: "push"
      path: ReactorPath
      remote?: string
      ref: string
      forceWithLease?: boolean
      setUpstream?: boolean
    }>

export type ReactionOperation =
  | Readonly<{
      kind: "agent"
      instruction: string
      path?: ReactorPath
      outputSchema?: unknown
      actions: readonly ReactionOperationActionRef[]
      model?: ReactionModel
      maxRounds?: number
    }>
  | Readonly<{
      kind: "action"
      action: ReactionOperationActionRef
      input: unknown
    }>
  | Readonly<{
      kind: "dataset"
      instruction: string
      recordSchema: unknown
      source: DatasetAdapterSource
    }>
  | Readonly<{ kind: "loadFiles" }>
  | Readonly<{ kind: "storeFiles"; input: ReactorStoreFilesInput }>
  | Readonly<{ kind: "shell"; input: ReactorShellRunInput }>
  | Readonly<{ kind: "git"; input: ReactionGitInput }>
  | Readonly<{
      kind: "emit"
      draft: DomainEventDraftLike
      channel?: string
    }>

export type ReactionOperationRequest = Readonly<{
  runtime: ContextRuntimeServiceHandle & {
    use(domain: unknown, options?: unknown): Promise<unknown>
    env?: unknown
    materializeDataset?: DatasetAdapterProvider
  }
  context: ReactorInitialContext<unknown>
  trigger: ContextEvent
  definition: string
  sessionId: string
  rootReactionId: string
  reactionId: string
  eventId: string
  position: number
  causeIds: readonly string[]
  engine: AnyReactionEngine<unknown> | false
  sandboxId: string | false
  operation: ReactionOperation
}>

export type ReactionOperationResult = Readonly<{
  event: ContextEvent
}>

export function toReactionOperationActionRef(
  action: AnyDomainAction,
): ReactionOperationActionRef {
  const binding = getDomainActionBinding(action)
  if (!binding) throw new Error("reaction_action_registration_required")
  return Object.freeze({
    id: binding.id,
    boundInput: Object.freeze({ ...binding.boundInput }),
  })
}

export function deriveDatasetSource(events: readonly ContextEvent[]): DatasetAdapterSource {
  const files = new Set<string>()
  for (const event of events) {
    for (const [alias, value] of Object.entries(event.links)) {
      if (event.physicalLinks[alias]?.target !== "$files") continue
      for (const id of Array.isArray(value) ? value : [value]) {
        if (typeof id === "string") files.add(id)
      }
    }
    if (event.type === "context.loadFiles") {
      const rows = Array.isArray((event.payload as any)?.files)
        ? (event.payload as any).files
        : []
      for (const row of rows) {
        if (typeof row?.fileId === "string" && row.fileId) files.add(row.fileId)
      }
    }
  }
  if (files.size > 0) {
    return Object.freeze({
      files: Object.freeze([...files].map(fileId => Object.freeze({ fileId }))),
    })
  }

  const datasets = new Set<string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== "object") return
    const datasetId = (value as any).datasetId
    if (typeof datasetId === "string" && datasetId) datasets.add(datasetId)
  }
  events.forEach(event => visit(event.payload))
  if (datasets.size > 0) {
    return Object.freeze({
      datasets: Object.freeze([...datasets].map(datasetId => Object.freeze({ datasetId }))),
    })
  }

  const rows = events.length === 1 && Array.isArray(events[0]!.payload)
    ? events[0]!.payload
    : events.map(event => event.payload)
  return Object.freeze({
    rows: Object.freeze([...rows]),
    name: "causal-events.jsonl",
    description: "Payloads selected explicitly through reaction.given(...).",
  })
}

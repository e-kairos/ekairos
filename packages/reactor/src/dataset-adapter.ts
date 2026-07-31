import type {
  ContextEvent,
  ContextRuntimeServiceHandle,
} from "@ekairos/events"

import type {
  AnyReactionEngine,
  ReactorInitialContext,
} from "./reactor.js"

export type DatasetAdapterFileSource = Readonly<{
  fileId: string
  description?: string
  filename?: string
  mediaType?: string
}>

export type DatasetAdapterSource =
  | Readonly<{ files: readonly DatasetAdapterFileSource[] }>
  | Readonly<{ datasets: readonly Readonly<{ datasetId: string; description?: string }>[] }>
  | Readonly<{ rows: readonly unknown[]; name?: string; description?: string }>
  | Readonly<{
      query: unknown
      domain?: unknown
      title?: string
      explanation?: string
    }>

export type DatasetAdapterEnsure = Readonly<{
  source: DatasetAdapterSource
  instructions?: string
  schema?: unknown
  title?: string
  output?: "rows" | "object"
}>

export type DatasetAdapterSpec =
  | Readonly<{
      datasetId: string
      ensure: DatasetAdapterEnsure
    }>
  | Readonly<{
      datasetId: string
      open: true
    }>

export type DatasetAdapterProviderResult<TRecord = unknown> = Readonly<{
  datasetId: string
  mode: "opened" | "built"
  previewRows?: readonly TRecord[]
  preview?: readonly TRecord[]
  count?: number
  reader: {
    read(params?: { cursor?: number; limit?: number }): Promise<{
      rows: TRecord[]
      cursor: number
      done: boolean
    }>
  }
}>

export type DatasetAdapterHandle<TRecord = unknown> = Readonly<{
  datasetId: string
  mode: "opened" | "built"
  preview: readonly TRecord[]
  previewTruncated?: boolean
  count?: number
}>

export type DatasetAdapterProviderInput = Readonly<{
  runtime: ContextRuntimeServiceHandle
  sandboxId?: string
  sessionId: string
  reactionId: string
  contextId: string
  context: ReactorInitialContext<unknown>
  trigger: ContextEvent
  engine?: AnyReactionEngine<unknown>
  spec: DatasetAdapterSpec
}>

export type DatasetAdapterProvider = (
  input: DatasetAdapterProviderInput,
) => Promise<DatasetAdapterProviderResult> | DatasetAdapterProviderResult

export type DatasetRuntimeCapability = ContextRuntimeServiceHandle & {
  materializeDataset: DatasetAdapterProvider
}

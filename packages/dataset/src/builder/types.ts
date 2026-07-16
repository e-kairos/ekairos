import type { InstaQLParams, ValidQuery } from "@instantdb/core"
import type { DomainInstantSchema, MaterializedDomainLike } from "@ekairos/domain"
import type { EkairosRuntime, RuntimeForDomain } from "@ekairos/domain/runtime"
import type { AiReactionEngine, ReactionEngine } from "@ekairos/reactor"

import { datasetDomain } from "../schema.js"
import type { DatasetNotation } from "../notation.js"

export type DatasetQuerySourceInput<
  D extends MaterializedDomainLike = MaterializedDomainLike,
> = {
  query: InstaQLParams<DomainInstantSchema<D>>
  title?: string
  explanation?: string
  domain: D
}

export type DatasetFileSourceInput = {
  fileId: string
  description?: string
  filename?: string
  mediaType?: string
}

export type DatasetTextSourceInput = {
  text: string
  mimeType?: string
  name?: string
  description?: string
}

export type DatasetExistingSourceInput = {
  datasetId: string
  description?: string
}

export type DatasetFileSource = { kind: "file" } & DatasetFileSourceInput
export type DatasetTextSource = { kind: "text" } & DatasetTextSourceInput
export type DatasetExistingSource = { kind: "dataset" } & DatasetExistingSourceInput

export type DatasetSourceInput =
  | DatasetFileSourceInput
  | DatasetTextSourceInput
  | DatasetExistingSourceInput
  | DatasetFileSource
  | DatasetTextSource
  | DatasetExistingSource

export type DatasetSourceDescriptor = {
  key: string
  kind: InternalDatasetSource["kind"]
  name: string
  description: string
  [key: string]: unknown
}

export type DatasetSchemaInput = {
  title?: string
  description?: string
  schema: any
}

export type DatasetOutput = "rows" | "object"
export type DatasetMode = "auto" | "schema"

export type DatasetBuilderOptions = {
  datasetId?: string
  parentSessionId?: string
}

export type DatasetBuildOptions = {
  datasetId?: string
}

export type InternalDatasetSource =
  | DatasetFileSource
  | DatasetTextSource
  | DatasetExistingSource
  | ({ kind: "query" } & DatasetQuerySourceInput)

export type DatasetReaderResult = {
  rows: any[]
  cursor: number
  done: boolean
}

export type DatasetReader = {
  read(cursor?: number, limit?: number): Promise<DatasetReaderResult>
  read(params?: { cursor?: number; limit?: number }): Promise<DatasetReaderResult>
}

export type DatasetBuildResult = {
  datasetId: string
  dataset: any
  /** the formal definition (intensional face), co-equal with the rows */
  notation: DatasetNotation | null
  /** preview of the materialization (extensional face) */
  previewRows: any[]
  reader: DatasetReader
  object?: any | null
  firstRow?: any | null
}

export type DatasetRuntimeEnv = { orgId: string }
export type DatasetReactionEngine = ReactionEngine<any> | AiReactionEngine
export type AnyDatasetRuntime = EkairosRuntime<any, any, any>
export type DatasetRuntimeHandle<Runtime extends AnyDatasetRuntime> = RuntimeForDomain<
  Runtime,
  typeof datasetDomain
>
export type CompatibleQueryDomain<
  Runtime extends AnyDatasetRuntime,
  D extends MaterializedDomainLike,
> = RuntimeForDomain<Runtime, D> extends never ? never : D

export type DatasetQuerySourceOptions<
  D extends MaterializedDomainLike,
  Q extends ValidQuery<Q, DomainInstantSchema<D>>,
> = {
  query: Q
  title?: string
  explanation?: string
}

export type DatasetBuilderState<Runtime extends AnyDatasetRuntime> = {
  runtime: Runtime
  env: Runtime["env"] & DatasetRuntimeEnv
  sources: InternalDatasetSource[]
  sourceDescriptors?: DatasetSourceDescriptor[]
  title?: string
  sandboxId?: string
  contextId?: string
  outputSchema?: DatasetSchemaInput
  output: DatasetOutput
  inferSchema: boolean
  instructions?: string
  engine?: DatasetReactionEngine
  parentSessionId?: string
  first: boolean
}

export type MaterializeRowsParams = {
  datasetId: string
  sandboxId?: string
  title?: string
  instructions?: string
  contextId: string
  analysis?: any
  rows: any[]
  schema?: DatasetSchemaInput
  inferSchema?: boolean
  first?: boolean
}

export type DatasetBuilder<Runtime extends AnyDatasetRuntime> = {
  readonly datasetId: string

  fromFile(resource: DatasetFileSourceInput): DatasetBuilder<Runtime>
  fromText(resource: DatasetTextSourceInput): DatasetBuilder<Runtime>
  fromDataset(resource: DatasetExistingSourceInput): DatasetBuilder<Runtime>
  from(...sources: DatasetSourceInput[]): DatasetBuilder<Runtime>
  fromQuery<
    D extends MaterializedDomainLike,
    Q extends ValidQuery<Q, DomainInstantSchema<D>>,
  >(
    domain: D & CompatibleQueryDomain<Runtime, D>,
    resource: DatasetQuerySourceOptions<D, Q>,
  ): DatasetBuilder<Runtime>

  title(title: string): DatasetBuilder<Runtime>
  sandbox(sandboxId: string): DatasetBuilder<Runtime>
  schema(schema: DatasetSchemaInput): DatasetBuilder<Runtime>
  inferSchema(): DatasetBuilder<Runtime>
  auto(): DatasetBuilder<Runtime>
  asRows(): DatasetBuilder<Runtime>
  asObject(): DatasetBuilder<Runtime>
  instructions(instructions: string): DatasetBuilder<Runtime>
  engine(engine: DatasetReactionEngine): DatasetBuilder<Runtime>
  first(): DatasetBuilder<Runtime>
  build(options?: DatasetBuildOptions): Promise<DatasetBuildResult>
}

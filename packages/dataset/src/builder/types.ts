import type { InstaQLParams, ValidQuery } from "@instantdb/core"
import type { DomainInstantSchema, DomainSchemaResult } from "@ekairos/domain"
import type { EkairosRuntime, RuntimeForDomain } from "@ekairos/domain/runtime"
import type { ContextIdentifier, ContextReactor } from "@ekairos/events"

import { datasetDomain } from "../schema.js"

export type DatasetQueryResourceInput<D extends DomainSchemaResult = DomainSchemaResult> = {
  query: InstaQLParams<DomainInstantSchema<D>>
  title?: string
  explanation?: string
  domain: D
}

export type DatasetFileResourceInput = {
  fileId: string
  description?: string
  filename?: string
  mediaType?: string
}

export type DatasetTextResourceInput = {
  text: string
  mimeType?: string
  name?: string
  description?: string
}

export type DatasetExistingResourceInput = {
  datasetId: string
  description?: string
}

export type DatasetContextResourceInput = ContextIdentifier

export type DatasetFileResource = { kind: "file" } & DatasetFileResourceInput
export type DatasetTextResource = { kind: "text" } & DatasetTextResourceInput
export type DatasetExistingResource = { kind: "dataset" } & DatasetExistingResourceInput
export type DatasetContextResource = { kind: "context" } & DatasetContextResourceInput

export type DatasetResourceInput =
  | DatasetFileResourceInput
  | DatasetTextResourceInput
  | DatasetExistingResourceInput
  | DatasetContextResourceInput
  | DatasetFileResource
  | DatasetTextResource
  | DatasetExistingResource
  | DatasetContextResource

export type DatasetSchemaInput = {
  title?: string
  description?: string
  schema: any
}

export type DatasetOutput = "rows" | "object"
export type DatasetMode = "auto" | "schema"

export type DatasetBuilderOptions = {
  datasetId?: string
  durable?: boolean
}

export type DatasetBuildOptions = {
  datasetId?: string
  durable?: boolean
}

export type InternalDatasetResource =
  | DatasetFileResource
  | DatasetTextResource
  | DatasetExistingResource
  | DatasetContextResource
  | ({ kind: "query" } & DatasetQueryResourceInput)

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
  previewRows: any[]
  reader: DatasetReader
  object?: any | null
  firstRow?: any | null
}

export type DatasetRuntimeEnv = { orgId: string }
export type AnyDatasetRuntime = EkairosRuntime<any, any, any>
export type DatasetRuntimeHandle<Runtime extends AnyDatasetRuntime> = RuntimeForDomain<
  Runtime,
  typeof datasetDomain
>
export type CompatibleQueryDomain<
  Runtime extends AnyDatasetRuntime,
  D extends DomainSchemaResult,
> = RuntimeForDomain<Runtime, D> extends never ? never : D

export type DatasetQueryResourceOptions<
  D extends DomainSchemaResult,
  Q extends ValidQuery<Q, DomainInstantSchema<D>>,
> = {
  query: Q
  title?: string
  explanation?: string
}

export type DatasetBuilderState<Runtime extends AnyDatasetRuntime> = {
  runtime: Runtime
  env: Runtime["env"] & DatasetRuntimeEnv
  resources: InternalDatasetResource[]
  title?: string
  sandboxId?: string
  contextId?: string
  outputSchema?: DatasetSchemaInput
  output: DatasetOutput
  inferSchema: boolean
  instructions?: string
  reactor?: ContextReactor<any, any>
  durable?: boolean
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

  fromFile(resource: DatasetFileResourceInput): DatasetBuilder<Runtime>
  fromText(resource: DatasetTextResourceInput): DatasetBuilder<Runtime>
  fromDataset(resource: DatasetExistingResourceInput): DatasetBuilder<Runtime>
  fromContext(context: DatasetContextResourceInput): DatasetBuilder<Runtime>
  from(...resources: DatasetResourceInput[]): DatasetBuilder<Runtime>
  fromQuery<
    D extends DomainSchemaResult,
    Q extends ValidQuery<Q, DomainInstantSchema<D>>,
  >(
    domain: D & CompatibleQueryDomain<Runtime, D>,
    resource: DatasetQueryResourceOptions<D, Q>,
  ): DatasetBuilder<Runtime>

  title(title: string): DatasetBuilder<Runtime>
  sandbox(input: { sandboxId: string }): DatasetBuilder<Runtime>
  schema(schema: DatasetSchemaInput): DatasetBuilder<Runtime>
  inferSchema(): DatasetBuilder<Runtime>
  auto(): DatasetBuilder<Runtime>
  asRows(): DatasetBuilder<Runtime>
  asObject(): DatasetBuilder<Runtime>
  instructions(instructions: string): DatasetBuilder<Runtime>
  reactor(reactor: ContextReactor<any, any>): DatasetBuilder<Runtime>
  first(): DatasetBuilder<Runtime>
  build(options?: DatasetBuildOptions): Promise<DatasetBuildResult>
}

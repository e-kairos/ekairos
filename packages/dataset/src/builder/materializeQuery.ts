import { materializeRowsToDataset } from "./persistence.js"
import { getDomainDescriptor, normalizeQueryRows } from "./rows.js"
import type {
  AnyDatasetRuntime,
  DatasetBuilderState,
  DatasetSchemaInput,
  InternalDatasetResource,
} from "./types.js"

async function readQueryResourceRowsStep(params: {
  runtime: any
  query: Record<string, any>
}): Promise<{ rows: any[] }> {
  "use step"
  const db = await params.runtime.db()
  const result = await (db as any).query(params.query as any)
  return { rows: normalizeQueryRows(result) }
}

export async function materializeQueryResource<Runtime extends AnyDatasetRuntime>(
  runtime: DatasetBuilderState<Runtime>["runtime"],
  resource: Extract<InternalDatasetResource, { kind: "query" }>,
  params: {
    datasetId: string
    sandboxId?: string
    schema?: DatasetSchemaInput
    title?: string
    instructions?: string
    first?: boolean
    contextId: string
  },
) {
  const { rows } = await readQueryResourceRowsStep({
    runtime,
    query: resource.query as any,
  })
  const domainDescriptor = getDomainDescriptor(resource.domain)

  return await materializeRowsToDataset(runtime, {
    datasetId: params.datasetId,
    sandboxId: params.sandboxId,
    title: params.title ?? resource.title,
    instructions: params.instructions,
    contextId: params.contextId,
    analysis: {
      query: resource.query,
      explanation: resource.explanation,
      ...domainDescriptor,
    },
    rows,
    schema: params.schema,
    inferSchema: !params.schema,
    first: params.first,
  })
}

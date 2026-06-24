import { tool } from "ai"
import { z } from "zod"
import type { DomainSchemaResult } from "@ekairos/domain"
import type { EkairosRuntime, RuntimeForDomain } from "@ekairos/domain/runtime"
import type { ContextReactor } from "@ekairos/reactor/context"
import { dataset, type DatasetSchemaInput } from "./dataset.js"
import { datasetDomain } from "./schema.js"

const fileResourceSchema = z.object({
  kind: z.literal("file"),
  fileId: z.string(),
  description: z.string().optional(),
})

const textResourceSchema = z.object({
  kind: z.literal("text"),
  text: z.string(),
  mimeType: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
})

const datasetResourceSchema = z.object({
  kind: z.literal("dataset"),
  datasetId: z.string(),
  description: z.string().optional(),
})

const queryResourceSchema = z.object({
  kind: z.literal("query"),
  query: z.record(z.string(), z.any()),
  title: z.string().optional(),
  explanation: z.string().optional(),
})

const contextInputSchema = z.union([
  z.object({ id: z.string() }),
  z.object({ key: z.string() }),
])

const datasetSchemaSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  schema: z.any(),
})

const materializeDatasetToolInputSchema = z.object({
  datasetId: z.string().optional(),
  sandboxId: z.string().optional(),
  title: z.string().optional(),
  context: contextInputSchema.optional(),
  files: z.array(fileResourceSchema.omit({ kind: true })).optional(),
  texts: z.array(textResourceSchema.omit({ kind: true })).optional(),
  datasets: z.array(datasetResourceSchema.omit({ kind: true })).optional(),
  queries: z.array(queryResourceSchema.omit({ kind: true })).optional(),
  instructions: z.string().optional(),
  mode: z.enum(["auto", "schema"]).optional(),
  output: z.enum(["rows", "object"]).optional(),
  schema: datasetSchemaSchema.optional(),
  first: z.boolean().optional(),
})

type MaterializeDatasetToolInput = z.infer<typeof materializeDatasetToolInputSchema>
type MaterializeDatasetRuntimeEnv = { orgId: string }
type AnyMaterializeDatasetRuntime = EkairosRuntime<any, any, any>
type MaterializeDatasetRuntimeHandle<
  Runtime extends AnyMaterializeDatasetRuntime,
> = RuntimeForDomain<Runtime, typeof datasetDomain>

type CompatibleToolQueryDomain<
  Runtime extends AnyMaterializeDatasetRuntime,
  QueryDomain extends DomainSchemaResult,
> = RuntimeForDomain<Runtime, QueryDomain> extends never ? never : QueryDomain

export function createMaterializeDatasetTool<
  Runtime extends AnyMaterializeDatasetRuntime,
  QueryDomain extends DomainSchemaResult,
>(params: {
  runtime: Runtime & MaterializeDatasetRuntimeHandle<Runtime>
  reactor?: ContextReactor<any, any>
  queryDomain: QueryDomain & CompatibleToolQueryDomain<Runtime, QueryDomain>
  toolName?: string
}) {
  return tool({
    description:
      "Materialize a dataset from declarative resources. Returns only the target datasetId. Query resources use the preconfigured runtime domain.",
    inputSchema: materializeDatasetToolInputSchema,
    execute: async (input: MaterializeDatasetToolInput) => {
      let builder = dataset(params.runtime)

      if (input.title?.trim()) {
        builder = builder.title(input.title)
      }
      if (input.sandboxId?.trim()) {
        builder = builder.sandbox({ sandboxId: input.sandboxId })
      }

      const materialCount =
        (input.files?.length ?? 0) +
        (input.texts?.length ?? 0) +
        (input.datasets?.length ?? 0) +
        (input.queries?.length ?? 0)
      if (input.context && materialCount > 0) {
        throw new Error("dataset_context_resource_is_exclusive")
      }
      if (!input.context && materialCount === 0) {
        throw new Error("dataset_context_or_material_required")
      }

      if (input.context) {
        builder = builder.fromContext(input.context)
      }
      for (const resource of input.files ?? []) {
        builder = builder.fromFile(resource)
      }
      for (const resource of input.texts ?? []) {
        builder = builder.fromText(resource)
      }
      for (const resource of input.datasets ?? []) {
        builder = builder.fromDataset(resource)
      }
      for (const resource of input.queries ?? []) {
        builder = (builder as any).fromQuery(params.queryDomain, {
          query: resource.query as any,
          title: resource.title,
          explanation: resource.explanation,
        })
      }

      if (input.output === "object") {
        builder = builder.asObject()
      } else {
        builder = builder.asRows()
      }

      if (input.schema) {
        builder = builder.schema(input.schema)
      } else if (input.mode === "auto" || input.mode === undefined) {
        builder = builder.inferSchema()
      }

      if (input.instructions?.trim()) {
        builder = builder.instructions(input.instructions)
      }

      if (input.first) {
        builder = builder.first()
      }

      if (params.reactor) {
        builder = builder.reactor(params.reactor)
      }

      const result = await builder.build({ datasetId: input.datasetId })
      return { datasetId: result.datasetId }
    },
  })
}

export { materializeDatasetToolInputSchema }

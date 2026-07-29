import type { DomainLike } from "@ekairos/domain"
import { z } from "zod"

import type { DatasetAdapterSource } from "./dataset-adapter.js"

export const AGENT_DATASET_ACTION = "dataset.materialize"

export type AgentDatasetDomainDescriptor = Readonly<{
  name: string
  entities: Readonly<Record<string, Readonly<{
    attributes: Readonly<Record<string, Readonly<{
      type: string
      required: boolean
      indexed: boolean
    }>>>
    links: Readonly<Record<string, Readonly<{
      entity: string
      cardinality: "one" | "many"
    }>>>
  }>>>
}>

export type AgentDatasetCapability = Readonly<{
  domain: AgentDatasetDomainDescriptor
  given: DatasetAdapterSource
}>

const querySourceSchema = z.object({
  kind: z.literal("query"),
  query: z.record(z.string(), z.unknown()),
}).strict()

const givenSourceSchema = z.object({ kind: z.literal("given") }).strict()

const datasetsSourceSchema = z.object({
  kind: z.literal("datasets"),
  datasetIds: z.array(z.string().trim().min(1)).min(1),
}).strict()

const filesSourceSchema = z.object({
  kind: z.literal("files"),
  fileIds: z.array(z.string().trim().min(1)).min(1),
}).strict()

export const agentDatasetInputSchema = z.object({
  title: z.string().trim().min(1),
  explanation: z.string().trim().min(1),
  source: z.discriminatedUnion("kind", [
    querySourceSchema,
    givenSourceSchema,
    datasetsSourceSchema,
    filesSourceSchema,
  ]),
  instructions: z.string().trim().min(1).optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  output: z.enum(["rows", "object"]).optional(),
}).strict()

export const agentDatasetOutputSchema = z.object({
  datasetId: z.string(),
  mode: z.enum(["opened", "built"]),
  preview: z.array(z.unknown()),
  count: z.number().optional(),
})

export type AgentDatasetInput = z.infer<typeof agentDatasetInputSchema>

export function describeAgentDatasetDomain(
  scope: DomainLike,
): AgentDatasetDomainDescriptor {
  const materialized = scope as DomainLike & {
    context?: (options?: { includeSchemas?: boolean }) => {
      name?: string
      schema?: unknown
    }
  }
  const context = materialized.context?.({ includeSchemas: true })
  const schema = asRecord(context?.schema ?? scope.instantSchema())
  const entityDefinitions = asRecord(schema.entities)
  const entities = Object.fromEntries(
    Object.entries(entityDefinitions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entityName, rawEntity]) => {
        const entity = asRecord(rawEntity)
        const attributes = Object.fromEntries(
          Object.entries(asRecord(entity.attrs))
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([attributeName, rawAttribute]) => {
              const attribute = asRecord(rawAttribute)
              return [attributeName, Object.freeze({
                type: typeof attribute.valueType === "string"
                  ? attribute.valueType
                  : "unknown",
                required: attribute.required === true,
                indexed: attribute.isIndexed === true,
              })]
            }),
        )
        const links = Object.fromEntries(
          Object.entries(asRecord(entity.links))
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([label, rawLink]) => {
              const link = asRecord(rawLink)
              const cardinality = link.cardinality === "one" ? "one" : "many"
              return [label, Object.freeze({
                entity: String(link.entityName ?? ""),
                cardinality,
              })]
            }),
        )
        return [entityName, Object.freeze({
          attributes: Object.freeze(attributes),
          links: Object.freeze(links),
        })]
      }),
  )
  const name = String(context?.name ?? "").trim()
  if (!name) throw new Error("reaction_dataset_domain_name_required")
  return Object.freeze({ name, entities: Object.freeze(entities) })
}

export function agentDatasetDescription(domain: AgentDatasetDomainDescriptor) {
  return [
    "Materialize a durable Dataset for collection-level evidence.",
    "Use this before answering cohort-wide grouping, counting, comparison, extraction, or aggregation questions. Prefer one Dataset query over repeated item-by-item actions.",
    "Set explanation to why this Dataset is needed and how its evidence supports the current answer.",
    "Use source.kind=query for a scoped InstaQL snapshot, given for the selected causal events, datasets to transform prior datasets, or files for linked files.",
    "An InstaQL query has entity names at the root, optional $ options, and nested link labels, for example { records: { $: { fields: [\"value\"] }, items: {} } }.",
    "The result is a durable handle with a preview; use its facts in the answer and create additional datasets when needed.",
    `Available scoped domain schema: ${JSON.stringify(domain)}`,
  ].join(" ")
}

export function resolveAgentDatasetSource(
  input: AgentDatasetInput,
  capability: AgentDatasetCapability,
): DatasetAdapterSource {
  switch (input.source.kind) {
    case "given":
      return capability.given
    case "datasets":
      return Object.freeze({
        datasets: Object.freeze(input.source.datasetIds.map(datasetId =>
          Object.freeze({ datasetId }))),
      })
    case "files":
      return Object.freeze({
        files: Object.freeze(input.source.fileIds.map(fileId =>
          Object.freeze({ fileId }))),
      })
    case "query":
      validateAgentDatasetQuery(input.source.query, capability.domain)
      return Object.freeze({
        query: input.source.query,
        domain: Object.freeze({
          meta: Object.freeze({ name: capability.domain.name }),
        }),
        title: input.title,
        explanation: input.explanation,
      })
  }
}

export function validateAgentDatasetQuery(
  query: Readonly<Record<string, unknown>>,
  domain: AgentDatasetDomainDescriptor,
) {
  const roots = Object.entries(query)
  if (roots.length === 0) throw new Error("reaction_dataset_query_empty")
  for (const [entityName, selection] of roots) {
    const entity = domain.entities[entityName]
    if (!entity) throw new Error(`reaction_dataset_query_entity_outside_scope:${entityName}`)
    validateSelection(entityName, selection, domain)
  }
}

function validateSelection(
  entityName: string,
  selection: unknown,
  domain: AgentDatasetDomainDescriptor,
) {
  const entity = domain.entities[entityName]!
  const value = requireRecord(
    selection,
    `reaction_dataset_query_selection_invalid:${entityName}`,
  )
  const options = value.$ === undefined
    ? {}
    : requireRecord(value.$, `reaction_dataset_query_options_invalid:${entityName}`)
  if (options.fields !== undefined && !Array.isArray(options.fields)) {
    throw new Error(`reaction_dataset_query_fields_invalid:${entityName}`)
  }
  if (Array.isArray(options.fields)) {
    for (const field of options.fields) {
      if (typeof field !== "string") {
        throw new Error(`reaction_dataset_query_field_invalid:${entityName}`)
      }
      if (field !== "id" && !entity.attributes[field]) {
        throw new Error(`reaction_dataset_query_field_outside_scope:${entityName}.${field}`)
      }
    }
  }
  for (const [label, nested] of Object.entries(value)) {
    if (label === "$") continue
    const link = entity.links[label]
    if (!link) throw new Error(`reaction_dataset_query_link_outside_scope:${entityName}.${label}`)
    if (!domain.entities[link.entity]) {
      throw new Error(`reaction_dataset_query_link_target_missing:${entityName}.${label}`)
    }
    validateSelection(link.entity, nested, domain)
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function requireRecord(value: unknown, error: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(error)
  }
  return value as Record<string, any>
}

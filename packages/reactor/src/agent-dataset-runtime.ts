import type { ContextEvent } from "@ekairos/events"
import { z } from "zod"

import {
  AGENT_DATASET_ACTION,
  describeAgentDatasetDomain,
  validateAgentDatasetQuery,
  type AgentDatasetCapability,
  type AgentDatasetDomainDescriptor,
} from "./agent-dataset.js"
import type {
  DatasetAdapterProviderResult,
  DatasetAdapterSource,
} from "./dataset-adapter.js"
import {
  DATASET_READ_ROW_CHARS,
  DATASET_READ_TOTAL_CHARS,
  compactJsonValue,
} from "./material-budget.js"

export { AGENT_DATASET_ACTION }
export const AGENT_DATASET_READ_ACTION = "dataset.read"

export type AgentDatasetAvailable = Readonly<{
  key: string
  datasetId: string
  title: string
  rowCount?: number
  preview: readonly unknown[]
}>

export type RuntimeAgentDatasetCapability = AgentDatasetCapability & Readonly<{
  available: readonly AgentDatasetAvailable[]
}>

export const agentDatasetMaterializeInputSchema = z.object({
  title: z.string().trim().min(1).describe("Short name for the durable Dataset."),
  instructions: z.string().trim().min(1)
    .describe("How to transform the selected causal evidence into rows.")
    .optional(),
  query: z.record(z.string(), z.unknown())
    .describe("Optional scoped InstaQL snapshot. Omit to use session.from(...) automatically.")
    .optional(),
  explanation: z.string().trim().min(1)
    .describe("Why an optional query is needed for this answer.")
    .optional(),
  schema: z.record(z.string(), z.unknown())
    .describe("Optional JSON Schema for each output row.")
    .optional(),
  output: z.enum(["rows", "object"]).optional(),
}).strict()

export const agentDatasetMaterializeOutputSchema = z.object({
  datasetId: z.string(),
  mode: z.enum(["opened", "built"]),
  preview: z.array(z.unknown()),
  count: z.number().optional(),
})

const scalarFilterValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

export const agentDatasetReadInputSchema = z.object({
  datasetId: z.string().trim().min(1)
    .describe("Dataset id from the available Dataset index or dataset.materialize."),
  cursor: z.number().int().min(0)
    .describe("Cursor returned by the previous read; omit for the first page.")
    .optional(),
  limit: z.number().int().min(1).max(100)
    .describe("Maximum matching rows to return in this call (default 50).")
    .optional(),
  filter: z.object({
    field: z.string().trim().min(1),
    equals: scalarFilterValue,
  }).strict().describe("Optional equality filter on one top-level row field.").optional(),
}).strict()

export const agentDatasetReadOutputSchema = z.object({
  datasetId: z.string(),
  rows: z.array(z.unknown()),
  nextCursor: z.number().int().min(0),
  done: z.boolean(),
})

export type AgentDatasetMaterializeInput =
  z.infer<typeof agentDatasetMaterializeInputSchema>
export type AgentDatasetReadInput = z.infer<typeof agentDatasetReadInputSchema>

export function describeAvailableAgentDatasets(
  events: readonly ContextEvent[],
): readonly AgentDatasetAvailable[] {
  const datasets = new Map<string, AgentDatasetAvailable>()
  const visit = (value: unknown, event: ContextEvent) => {
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, event))
      return
    }
    if (!value || typeof value !== "object") return
    const record = value as Record<string, unknown>
    const datasetId = typeof record.datasetId === "string"
      ? record.datasetId.trim()
      : ""
    const isDatasetHandle = Boolean(
      datasetId &&
        (
          Array.isArray(record.preview) ||
          Array.isArray(record.previewRows) ||
          record.mode === "opened" ||
          record.mode === "built"
        ),
    )
    if (isDatasetHandle) {
      const preview = Array.isArray(record.preview)
        ? record.preview.slice(0, 3).map(compactPreviewRow)
        : Array.isArray(record.previewRows)
          ? record.previewRows.slice(0, 3).map(compactPreviewRow)
          : []
      const title = typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : typeof event.metadata?.instruction === "string" &&
            event.metadata.instruction.trim()
          ? event.metadata.instruction.trim()
          : `Dataset ${datasetId}`
      datasets.set(datasetId, Object.freeze({
        key: event.name ? `${event.domain}.${event.name}` : datasetId,
        datasetId,
        title,
        ...(typeof record.count === "number" ? { rowCount: record.count } : {}),
        preview: Object.freeze(preview),
      }))
      return
    }
    Object.values(record).forEach(item => visit(item, event))
  }
  events.forEach(event => visit(event.payload, event))
  return Object.freeze([...datasets.values()])
}

export function agentDatasetPromptIndex(
  capability: AgentDatasetCapability,
) {
  const available = runtimeCapability(capability).available
  return [
    "## Available Datasets",
    "",
    JSON.stringify(available.map(dataset => ({
      key: dataset.key,
      datasetId: dataset.datasetId,
      title: dataset.title,
      rowCount: dataset.rowCount,
      preview: dataset.preview,
    })), null, 2),
    "",
    "The preview is discovery metadata only. Ground every factual claim in rows returned by dataset.read. Read enough pages to cover the evidence; never infer missing rows or timestamps from the preview.",
  ].join("\n")
}

export function agentDatasetMaterializeDescription(
  domain: AgentDatasetDomainDescriptor,
) {
  return [
    "Create or open a durable Dataset when the selected causal evidence needs collection-level transformation.",
    "The source is automatically session.from(...); do not provide or reconstruct a source.",
    "Provide a short title and optional transformation instructions/schema.",
    "Use the optional query only for a scoped domain snapshot; its entities and links must belong to the Session scope.",
    "After materialization, call dataset.read before using row facts in the final answer.",
    `Scoped domain schema: ${JSON.stringify(domain)}`,
  ].join(" ")
}

export function resolveAgentDatasetMaterializeSource(
  input: AgentDatasetMaterializeInput,
  capability: AgentDatasetCapability,
): DatasetAdapterSource {
  if (!input.query) return capability.given
  validateAgentDatasetQuery(input.query, capability.domain)
  return Object.freeze({
    query: input.query,
    domain: Object.freeze({
      meta: Object.freeze({ name: capability.domain.name }),
    }),
    title: input.title,
    explanation: input.explanation,
  })
}

export async function readAgentDatasetRows(
  opened: DatasetAdapterProviderResult,
  input: AgentDatasetReadInput,
) {
  const wanted = input.limit ?? 50
  let cursor = input.cursor ?? 0
  let done = false
  let spentChars = 0
  const rows: unknown[] = []

  while (!done && rows.length < wanted && spentChars < DATASET_READ_TOTAL_CHARS) {
    const pageStart = cursor
    const page = await opened.reader.read({
      cursor,
      limit: Math.min(100, Math.max(wanted - rows.length, 25)),
    })
    let processed = 0
    for (const row of page.rows) {
      processed += 1
      if (!matchesFilter(row, input.filter)) continue
      const compact = compactJsonValue(row, DATASET_READ_ROW_CHARS)
      rows.push(compact)
      spentChars += jsonLength(compact)
      if (rows.length >= wanted || spentChars >= DATASET_READ_TOTAL_CHARS) {
        cursor = pageStart + processed
        done = page.done && cursor >= page.cursor
        break
      }
    }
    if (rows.length < wanted && spentChars < DATASET_READ_TOTAL_CHARS) {
      cursor = page.cursor
      done = page.done
    }
    if (!done && page.rows.length === 0 && cursor <= pageStart) {
      throw new Error(`reaction_dataset_reader_no_progress:${input.datasetId}:${cursor}`)
    }
  }

  return Object.freeze({
    datasetId: input.datasetId,
    rows: Object.freeze(rows),
    nextCursor: cursor,
    done,
  })
}

export {
  describeAgentDatasetDomain,
  type AgentDatasetCapability,
  type AgentDatasetDomainDescriptor,
}

function runtimeCapability(
  capability: AgentDatasetCapability,
): RuntimeAgentDatasetCapability {
  const available = "available" in capability && Array.isArray(capability.available)
    ? capability.available as readonly AgentDatasetAvailable[]
    : []
  return Object.freeze({
    ...capability,
    available,
  }) as RuntimeAgentDatasetCapability
}

function matchesFilter(
  row: unknown,
  filter: AgentDatasetReadInput["filter"],
) {
  if (!filter) return true
  if (!row || typeof row !== "object" || Array.isArray(row)) return false
  return Object.is((row as Record<string, unknown>)[filter.field], filter.equals)
}

function jsonLength(value: unknown): number {
  try {
    return (JSON.stringify(value) ?? String(value)).length
  } catch {
    return String(value).length
  }
}

function compactPreviewRow(row: unknown) {
  try {
    const rendered = JSON.stringify(row) ?? String(row)
    return rendered.length <= 600
      ? row
      : `${rendered.slice(0, 600)}...[truncated]`
  } catch {
    return String(row)
  }
}

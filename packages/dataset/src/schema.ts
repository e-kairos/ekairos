import { i } from "@instantdb/core"
import {
  DOMAIN_ACTION_FULL_INPUT_TYPE,
  DOMAIN_ACTION_OWNER_TYPE,
  DOMAIN_ACTION_RUNTIME_TYPE,
  defineEvent,
  domain,
} from "@ekairos/domain"
import { contextDomain } from "@ekairos/events"
import { z } from "zod"
import { datasetActions } from "./actions.js"

export * from "./actions.js"

const entities = {
  dataset_datasets: i.entity({
    datasetId: i.string().unique().indexed(),
    sandboxId: i.string().optional().indexed(),
    status: i.string().optional().indexed(),
    createdAt: i.number().optional().indexed(),
    updatedAt: i.number().optional(),
    organizationId: i.string().optional().indexed(),
    title: i.string().optional(),
    instructions: i.string().optional(),
    analysis: i.json().optional(),
    schema: i.json().optional(),
    /** formal notation (LaTeX + checkable predicates) describing the set */
    notation: i.json().optional(),
    calculatedTotalRows: i.number().optional(),
    actualGeneratedRowCount: i.number().optional(),
  }),
  dataset_records: i.entity({
    rowContent: i.json(),
    order: i.number().indexed(),
    createdAt: i.number(),
  }),
} as const

const links = {
  dataset_datasetsRecords: {
    forward: { on: "dataset_datasets", has: "many", label: "records" },
    reverse: { on: "dataset_records", has: "one", label: "dataset" },
  },
  dataset_datasetsFiles: {
    forward: { on: "dataset_datasets", has: "one", label: "dataFile" },
    reverse: { on: "$files", has: "many", label: "datasets" },
  },
  dataset_datasetsContext: {
    forward: { on: "dataset_datasets", has: "one", label: "context" },
    reverse: { on: "context_contexts", has: "many", label: "datasets" },
  },
} as const

const rooms = {} as const

const materializationRequested = defineEvent({
  payload: z.object({
    mode: z.enum(["file", "transform"]),
    prompt: z.string(),
  }),
  links: {
    target: { on: "dataset_datasets", has: "one" },
    sources: { on: "dataset_datasets", has: "many" },
    file: { on: "$files", has: "one" },
  },
})

const materialized = defineEvent({
  payload: z.object({
    datasetId: z.string(),
    status: z.literal("materialized"),
  }),
  links: {
    target: { on: "dataset_datasets", has: "one" },
  },
})

export const datasetDomain = domain("dataset")
  .includes(contextDomain)
  .withSchema({ entities, links, rooms })
  .withEvents({ materializationRequested, materialized })
  .withActions(datasetActions)


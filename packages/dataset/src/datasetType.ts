import { z } from "zod"

declare const DATASET_ITEM_TYPE: unique symbol

/** A durable dataset identity whose records have a statically known type. */
export type Dataset<TItem> = Readonly<{
  datasetId: string
  readonly [DATASET_ITEM_TYPE]: (item: TItem) => TItem
}>

/** The portable value accepted at an action boundary. */
export type DatasetReference = Readonly<{
  datasetId: string
}>

export type DatasetType<TItemSchema extends z.ZodType> = z.ZodType<
  Dataset<z.output<TItemSchema>>,
  DatasetReference
>

export const DATASET_JSON_SCHEMA_KEY = "x-ekairos-dataset" as const

type DatasetJsonSchemaMetadata = Readonly<{
  itemSchema: unknown
}>

export function getDatasetItemSchema(type: z.ZodType): unknown {
  const metadata = type.meta()?.[DATASET_JSON_SCHEMA_KEY] as
    | DatasetJsonSchemaMetadata
    | undefined
  if (!metadata || !("itemSchema" in metadata)) {
    throw new Error("dataset_type_item_schema_required")
  }
  return metadata.itemSchema
}

export function isZodType(value: unknown): value is z.ZodType {
  if (!value || typeof value !== "object") return false
  const candidate = value as {
    _zod?: unknown
    parse?: unknown
    safeParse?: unknown
  }
  return (
    candidate._zod !== undefined &&
    typeof candidate.parse === "function" &&
    typeof candidate.safeParse === "function"
  )
}

export function createDatasetType<TItemSchema extends z.ZodType>(
  itemType: TItemSchema,
): DatasetType<TItemSchema> {
  const itemSchema = portableItemSchema(itemType)
  const metadata: DatasetJsonSchemaMetadata = Object.freeze({ itemSchema })
  const reference = z.object({
    datasetId: z.string().trim().min(1),
  }).meta({
    title: "Dataset reference",
    description: [
      "Reference to a durable dataset.",
      "Every record in the referenced dataset must satisfy this JSON Schema:",
      JSON.stringify(itemSchema),
    ].join(" "),
    [DATASET_JSON_SCHEMA_KEY]: metadata,
  })

  return reference as unknown as DatasetType<TItemSchema>
}

function portableItemSchema(itemType: z.ZodType): unknown {
  const converted = z.toJSONSchema(itemType, { target: "draft-7" })
  if (!converted || typeof converted !== "object" || Array.isArray(converted)) {
    return converted
  }
  const { $schema: _dialect, ...schema } = converted as Record<string, unknown>
  return Object.freeze(schema)
}

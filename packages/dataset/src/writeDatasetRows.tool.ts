import { tool } from "ai"
import { z, type ZodTypeAny } from "zod"
import { validateRows } from "./builder/schemaInference.js"
import type { DatasetSchemaInput } from "./builder/types.js"
import { getDatasetRuntimeDb } from "./dataset/steps.js"
import { DatasetService } from "./service.js"

type WriteRowsToolParams = {
  datasetId: string
  sandboxId: string
  runtime: any
  schema?: DatasetSchemaInput | any
}

const rowSchema = z.record(z.string(), z.any())

function normalizeJsonSchema(schemaInput: DatasetSchemaInput | any): any {
  if (!schemaInput || typeof schemaInput !== "object") return null
  return schemaInput.schema && typeof schemaInput.schema === "object"
    ? schemaInput.schema
    : schemaInput
}

function applyDescription(schema: ZodTypeAny, jsonSchema: any): ZodTypeAny {
  const description = typeof jsonSchema?.description === "string"
    ? jsonSchema.description.trim()
    : ""
  return description ? schema.describe(description) : schema
}

function unionSchemas(schemas: ZodTypeAny[]): ZodTypeAny {
  if (schemas.length === 0) return z.any()
  if (schemas.length === 1) return schemas[0]!
  return z.union(schemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
}

function literalSchema(value: unknown): ZodTypeAny {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return z.literal(value)
  }
  return z.any()
}

function zodFromJsonSchema(jsonSchema: any): ZodTypeAny {
  if (!jsonSchema || typeof jsonSchema !== "object") return z.any()

  if (Array.isArray(jsonSchema.enum) && jsonSchema.enum.length > 0) {
    return applyDescription(
      unionSchemas(jsonSchema.enum.map((value: unknown) => literalSchema(value))),
      jsonSchema,
    )
  }

  if (Array.isArray(jsonSchema.anyOf) && jsonSchema.anyOf.length > 0) {
    return applyDescription(
      unionSchemas(jsonSchema.anyOf.map((entry: any) => zodFromJsonSchema(entry))),
      jsonSchema,
    )
  }

  if (Array.isArray(jsonSchema.oneOf) && jsonSchema.oneOf.length > 0) {
    return applyDescription(
      unionSchemas(jsonSchema.oneOf.map((entry: any) => zodFromJsonSchema(entry))),
      jsonSchema,
    )
  }

  if (Array.isArray(jsonSchema.type)) {
    const nonNullTypes = jsonSchema.type.filter((type: unknown) => type !== "null")
    const schemas = nonNullTypes.map((type: unknown) =>
      zodFromJsonSchema({ ...jsonSchema, type }),
    )
    if (jsonSchema.type.includes("null")) {
      schemas.push(z.null())
    }
    return applyDescription(unionSchemas(schemas), jsonSchema)
  }

  switch (jsonSchema.type) {
    case "object": {
      const properties = jsonSchema.properties && typeof jsonSchema.properties === "object"
        ? jsonSchema.properties
        : {}
      const required = new Set(
        Array.isArray(jsonSchema.required)
          ? jsonSchema.required.map((key: unknown) => String(key))
          : [],
      )
      const shape: Record<string, ZodTypeAny> = {}
      for (const [key, propertySchema] of Object.entries(properties)) {
        const property = zodFromJsonSchema(propertySchema)
        shape[key] = required.has(key) ? property : property.optional()
      }
      const objectSchema = z.object(shape)
      return applyDescription(
        jsonSchema.additionalProperties === false
          ? objectSchema.strict()
          : objectSchema.passthrough(),
        jsonSchema,
      )
    }
    case "array":
      return applyDescription(
        z.array(zodFromJsonSchema(jsonSchema.items)),
        jsonSchema,
      )
    case "integer":
      return applyDescription(z.number().int(), jsonSchema)
    case "number":
      return applyDescription(z.number(), jsonSchema)
    case "boolean":
      return applyDescription(z.boolean(), jsonSchema)
    case "null":
      return applyDescription(z.null(), jsonSchema)
    case "string":
      return applyDescription(z.string(), jsonSchema)
    default:
      return applyDescription(z.any(), jsonSchema)
  }
}

function createToolRowSchema(schemaInput: DatasetSchemaInput | any): ZodTypeAny {
  const jsonSchema = normalizeJsonSchema(schemaInput)
  if (!jsonSchema) return rowSchema
  return zodFromJsonSchema(jsonSchema)
}

export async function persistDatasetRowsStep(params: WriteRowsToolParams & {
  rows: Array<Record<string, unknown>>
  summary?: string
}) {
  "use step"

  const db = await getDatasetRuntimeDb(params.runtime)
  const service = new DatasetService(db)
  const datasetResult = await service.getDatasetById(params.datasetId)
  if (!datasetResult.ok) {
    return {
      success: false,
      status: "dataset_not_found",
      rowSource: "direct",
      outputPath: null,
      storagePath: null,
      error: datasetResult.error,
      message: datasetResult.error,
    }
  }

  const schema = datasetResult.data?.schema
  if (!schema) {
    return {
      success: false,
      status: "schema_missing",
      rowSource: "direct",
      outputPath: null,
      storagePath: null,
      error: "Schema not found in database. Please generate schema first.",
      message: "Schema not found in database. Please generate schema first.",
    }
  }

  try {
    validateRows(params.rows, schema)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      status: "validation_failed",
      rowSource: "direct",
      outputPath: null,
      storagePath: null,
      validRows: 0,
      rowRecordCount: params.rows.length,
      error: message,
      message,
      repairInstructions: [
        "Return rows using exactly the dataset output schema property names.",
        "Populate all required fields and use only allowed enum values.",
      ],
    }
  }

  const clearResult = await service.clearDataset(params.datasetId)
  if (!clearResult.ok) {
    return {
      success: false,
      status: "clear_failed",
      rowSource: "direct",
      outputPath: null,
      storagePath: null,
      error: clearResult.error,
      message: clearResult.error,
    }
  }

  const saved = await service.addDatasetRecords({
    datasetId: params.datasetId,
    records: params.rows.map((row, order) => ({ rowContent: row, order })),
  })
  if (!saved.ok) {
    return {
      success: false,
      status: "record_save_failed",
      rowSource: "direct",
      outputPath: null,
      storagePath: null,
      error: saved.error,
      message: saved.error,
    }
  }

  const statusResult = await service.updateDatasetStatus({
    datasetId: params.datasetId,
    status: "completed",
    calculatedTotalRows: params.rows.length,
    actualGeneratedRowCount: params.rows.length,
  })
  if (!statusResult.ok) {
    return {
      success: false,
      status: "status_update_failed",
      rowSource: "direct",
      outputPath: null,
      storagePath: null,
      validRows: params.rows.length,
      rowRecordCount: params.rows.length,
      savedRecords: saved.data.savedCount,
      error: statusResult.error,
      message: statusResult.error,
    }
  }

  return {
    success: true,
    status: "completed",
    rowSource: "direct",
    outputPath: null,
    storagePath: null,
    records: params.rows.length,
    savedRecords: saved.data.savedCount,
    summary: params.summary,
  }
}

export function createReplaceRowsTool(params: WriteRowsToolParams) {
  const toolRowSchema = createToolRowSchema(params.schema)
  const inputSchema = z.object({
    rows: z
      .array(toolRowSchema)
      .min(1)
      .describe("Output dataset rows. Each row must match the dataset output schema exactly."),
    summary: z
      .string()
      .optional()
      .describe("Short summary of the completed dataset including record count and structure."),
  })

  return tool({
    description:
      "Replace the dataset output with rows provided directly as JSON objects, then validate and complete the dataset.",
    inputSchema: inputSchema as any,
    execute: async ({ rows, summary }: { rows: Array<Record<string, unknown>>; summary?: string }) => {
      const finalSummary = summary || `Completed dataset with ${rows.length} rows.`
      console.log(`[Dataset ${params.datasetId}] ========================================`)
      console.log(`[Dataset ${params.datasetId}] Tool: replaceRows`)
      console.log(`[Dataset ${params.datasetId}] Rows: ${rows.length}`)
      console.log(`[Dataset ${params.datasetId}] Summary: ${finalSummary}`)
      console.log(`[Dataset ${params.datasetId}] ========================================`)

      return await persistDatasetRowsStep({
        ...params,
        rows,
        summary: finalSummary,
      })
    },
  })
}

export function createCompleteObjectTool(params: WriteRowsToolParams) {
  const toolRowSchema = createToolRowSchema(params.schema)
  const inputSchema = z.object({
    data: toolRowSchema.describe("Required final object. It must match the dataset output schema exactly. This field is mandatory; do not omit it."),
    summary: z
      .string()
      .optional()
      .describe("Short summary of the completed object and why it satisfies the output schema."),
  })

  return tool({
    description:
      "Complete an object-mode dataset by providing the final object directly. This writes one dataset row, validates it against the output schema, and completes the dataset. Do not call this tool until the final data object is fully constructed. Never call completeObject with only a summary.",
    inputSchema: inputSchema as any,
    execute: async ({ data, summary }: { data: Record<string, unknown>; summary?: string }) => {
      const finalSummary = summary || "Completed object dataset."
      console.log(`[Dataset ${params.datasetId}] ========================================`)
      console.log(`[Dataset ${params.datasetId}] Tool: completeObject`)
      console.log(`[Dataset ${params.datasetId}] Summary: ${finalSummary}`)
      console.log(`[Dataset ${params.datasetId}] ========================================`)

      return await persistDatasetRowsStep({
        ...params,
        rows: [data],
        summary: finalSummary,
      })
    },
  })
}

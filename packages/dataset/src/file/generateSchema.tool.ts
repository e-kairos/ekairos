import { defineAction, type DomainActionDefinition } from "@ekairos/domain"
import { z } from "zod"

import { datasetUpdateSchemaStep } from "../dataset/steps.js"

export const generateSchemaInputSchema = z.object({
  datasetId: z.string(),
  isNested: z.boolean().optional(),
  fileId: z.string().optional(),
  schemaTitle: z
    .string()
    .describe("Title for the RECORD schema in PascalCase (e.g., 'ProductRecord', 'TransactionRecord')"),
  schemaDescription: z
    .string()
    .describe(
      "Comprehensive description that includes: 1) what ONE record represents, 2) its purpose, 3) complete field mapping from original file fields to schema fields with explanations",
    ),
  schemaJson: z
    .string()
    .describe(
      "Complete JSON schema as string describing ONE RECORD. Must be type 'object' with properties. All properties must be in lowercaseCamelCase and have descriptions. Do NOT use type 'array' at root level.",
    ),
})

export const generateSchemaOutputSchema = z
  .object({
    success: z.boolean(),
    schema: z
      .object({
        title: z.string(),
        description: z.string(),
        schema: z.unknown(),
        generatedAt: z.string(),
      })
      .optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough()

export const generateSchema: DomainActionDefinition<
  typeof generateSchemaInputSchema,
  typeof generateSchemaOutputSchema
> = defineAction({
  description: `Generate a formal JSON schema for a SINGLE RECORD (row) from the file. This schema describes the structure of ONE record, not the entire dataset or array of records. Requirements:
1. Schema describes ONE RECORD structure only (no array wrappers)
2. All property names MUST use lowercaseCamelCase convention (e.g., 'productName', 'unitPrice')
3. Each property MUST have a description field
4. The schema description must explain what one record represents and field mappings from original file`,
  input: generateSchemaInputSchema,
  output: generateSchemaOutputSchema,
  execute: async ({ input, runtime }) => {
    const { datasetId, schemaTitle, schemaDescription, schemaJson } = input

    console.log(`[Dataset ${datasetId}] ========================================`)
    console.log(`[Dataset ${datasetId}] Action: generateSchema`)
    console.log(`[Dataset ${datasetId}] Title: ${schemaTitle}`)
    console.log(`[Dataset ${datasetId}] ========================================`)

    try {
      const parsedSchema = JSON.parse(schemaJson)

      if (parsedSchema.type === "array") {
        return {
          success: false,
          error:
            "Schema must describe a SINGLE RECORD (type: 'object'), not an array. Remove array wrapper and describe just one record structure.",
        }
      }

      const validateSchema = (obj: any, path = ""): string[] => {
        const errors: string[] = []

        if (obj.properties) {
          for (const [key, value] of Object.entries(obj.properties)) {
            if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) {
              errors.push(`Property "${key}" at ${path} does not follow lowercaseCamelCase convention`)
            }

            const property = value as any
            if (!property.description || property.description.trim() === "") {
              errors.push(`Property "${key}" at ${path} is missing description`)
            }
          }
        }

        if (obj.items?.properties) {
          errors.push(...validateSchema(obj.items, `${path}.items`))
        }

        return errors
      }

      const validationErrors = validateSchema(parsedSchema)
      if (validationErrors.length > 0) {
        return {
          success: false,
          error: `Schema validation failed: ${validationErrors.join("; ")}`,
        }
      }

      const schemaData = {
        title: schemaTitle,
        description: schemaDescription,
        schema: parsedSchema,
        generatedAt: new Date().toISOString(),
      }

      const updateResult = await datasetUpdateSchemaStep({
        runtime,
        datasetId,
        schema: schemaData,
        status: "schema_complete",
      })

      if (!updateResult.ok) {
        return { success: false, error: updateResult.error }
      }

      return {
        success: true,
        schema: schemaData,
        message: "Schema generated successfully",
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  },
})

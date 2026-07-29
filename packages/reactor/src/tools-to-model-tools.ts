import { z } from "zod"

/**
 * Serializable "tool" shape to pass across the Workflow step boundary.
 *
 * Mirrors Workflow DevKit's DurableAgent strategy:
 * - Keep Zod/function values out of step arguments
 * - Convert tool input schemas to plain JSON Schema in workflow context
 */
export type SerializableFunctionActionSpec = {
  type?: "function"
  description?: string
  inputSchema: unknown
  outputSchema?: unknown
  providerOptions?: unknown
}

export type SerializableProviderDefinedActionSpec = {
  type: "provider-defined"
  id: string
  name?: string
  args?: Record<string, unknown>
}

export type SerializableActionSpec =
  | SerializableFunctionActionSpec
  | SerializableProviderDefinedActionSpec

function toJsonSchema(schema: unknown): unknown {
  if (!schema) return schema
  const jsonSchema = (schema as { jsonSchema?: unknown })?.jsonSchema
  if (jsonSchema) return jsonSchema
  try {
    return z.toJSONSchema(schema as never)
  } catch {
    return schema
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

const WIRE_RESULT_KEY = "result"

type ToolInputWire = Readonly<{
  schema: unknown
  wrapped: boolean
}>

function toolInputWire(schema: unknown): ToolInputWire {
  if (asRecord(schema).type === "object") {
    return Object.freeze({ schema, wrapped: false })
  }
  return Object.freeze({
    wrapped: true,
    schema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        [WIRE_RESULT_KEY]: schema,
      }),
      required: Object.freeze([WIRE_RESULT_KEY]),
      additionalProperties: false,
    }),
  })
}

function wireDescription(description: string | undefined, wrapped: boolean) {
  return [
    description,
    wrapped ? `Pass the complete input value in the "${WIRE_RESULT_KEY}" field.` : undefined,
  ].filter(Boolean).join(" ") || undefined
}

export function decodeActionSpecInput(
  spec: SerializableActionSpec | undefined,
  input: unknown,
): unknown {
  if (!spec || spec.type === "provider-defined") return input
  const wire = toolInputWire(spec.inputSchema)
  if (!wire.wrapped) return input
  const record = asRecord(input)
  return Object.prototype.hasOwnProperty.call(record, WIRE_RESULT_KEY)
    ? record[WIRE_RESULT_KEY]
    : input
}

export function normalizeRespondToolInput(
  schema: z.ZodType,
  input: unknown,
): unknown {
  const direct = schema.safeParse(input)
  if (direct.success) return input

  const jsonSchema = toJsonSchema(schema)
  const decoded = decodeStructuredJsonStrings(input, jsonSchema, jsonSchema)
  const fallback = schema.safeParse(decoded)
  if (fallback.success) return decoded
  throw direct.error
}

function decodeStructuredJsonStrings(
  input: unknown,
  schema: unknown,
  rootSchema: unknown,
): unknown {
  const resolved = resolveLocalRef(schema, rootSchema)
  let value = input
  if (typeof value === "string" && acceptsStructuredJson(resolved, rootSchema)) {
    try {
      const parsed = JSON.parse(value)
      if (parsed !== null && typeof parsed === "object") value = parsed
    } catch {
      // Keep the original string so the caller reports the normal schema error.
    }
  }

  const record = asRecord(resolved)
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    const branches = record[keyword]
    if (!Array.isArray(branches)) continue
    for (const branch of branches) {
      value = decodeStructuredJsonStrings(value, branch, rootSchema)
    }
  }

  if (Array.isArray(value)) {
    if (record.items !== undefined) {
      return value.map(item => decodeStructuredJsonStrings(item, record.items, rootSchema))
    }
    return value
  }
  if (!value || typeof value !== "object") return value

  const properties = asRecord(record.properties)
  let decoded: Record<string, unknown> | undefined
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    const current = (value as Record<string, unknown>)[key]
    const next = decodeStructuredJsonStrings(current, propertySchema, rootSchema)
    if (next === current) continue
    decoded ??= { ...(value as Record<string, unknown>) }
    decoded[key] = next
  }
  return decoded ?? value
}

function acceptsStructuredJson(
  schema: unknown,
  rootSchema: unknown,
  seenRefs = new Set<string>(),
): boolean {
  const record = asRecord(schema)
  const ref = typeof record.$ref === "string" ? record.$ref : undefined
  if (ref) {
    if (seenRefs.has(ref)) return false
    const nextSeen = new Set(seenRefs)
    nextSeen.add(ref)
    return acceptsStructuredJson(resolveLocalRef(schema, rootSchema), rootSchema, nextSeen)
  }

  const type = record.type
  if (type === "object" || type === "array") return true
  if (Array.isArray(type) && (type.includes("object") || type.includes("array"))) {
    return true
  }
  return ["allOf", "anyOf", "oneOf"].some(keyword => {
    const branches = record[keyword]
    return Array.isArray(branches) && branches.some(branch =>
      acceptsStructuredJson(branch, rootSchema, seenRefs))
  })
}

function resolveLocalRef(schema: unknown, rootSchema: unknown): unknown {
  const ref = asRecord(schema).$ref
  if (typeof ref !== "string" || !ref.startsWith("#/")) return schema
  let current: unknown = rootSchema
  for (const encodedSegment of ref.slice(2).split("/")) {
    const segment = encodedSegment.replace(/~1/g, "/").replace(/~0/g, "~")
    current = asRecord(current)[segment]
  }
  return current ?? schema
}

/**
 * @deprecated Use SerializableActionSpec.
 */
export type SerializableToolForModel = SerializableActionSpec

function isProviderDefinedTool(tool: unknown): tool is {
  type: "provider-defined"
  id: string
  name?: string
  args?: Record<string, unknown>
} {
  const record = asRecord(tool)
  return (
    record.type === "provider-defined" &&
    typeof record.id === "string" &&
    record.id.trim().length > 0
  )
}

/**
 * Convert AI SDK tools to a serializable representation that can be passed to `"use-step"` functions.
 *
 * This matches DurableAgent's internal `toolsToModelTools` behavior:
 * `inputSchema: asSchema(tool.inputSchema).jsonSchema`
 */
export function actionsToActionSpecs(
  tools: Record<string, unknown>,
): Record<string, SerializableActionSpec> {
  const out: Record<string, SerializableActionSpec> = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (isProviderDefinedTool(tool)) {
      out[name] = {
        type: "provider-defined",
        id: tool.id,
        name: tool.name,
        args: tool.args,
      }
      continue
    }

    const record = asRecord(tool)
    const inputSchema = record.inputSchema ?? record.input
    if (!inputSchema) {
      throw new Error(
        `Context: action "${name}" is missing input/inputSchema (required for model action calls)`,
      )
    }
    const outputSchema = record.outputSchema ?? record.output
    out[name] = {
      type: "function",
      description: typeof record.description === "string" ? record.description : undefined,
      inputSchema: toJsonSchema(inputSchema),
      outputSchema: outputSchema ? toJsonSchema(outputSchema) : undefined,
      providerOptions: record.providerOptions,
    }
  }
  return out
}

export function actionSpecToAiSdkTool(
  name: string,
  spec: SerializableActionSpec,
  wrapJsonSchema: (schema: unknown) => unknown,
) {
  if (spec.type === "provider-defined") {
    return {
      type: "provider-defined" as const,
      id: spec.id,
      name: spec.name ?? name,
      args: spec.args ?? {},
    }
  }

  const inputWire = toolInputWire(spec.inputSchema)
  return {
    type: "function" as const,
    description: wireDescription(spec.description, inputWire.wrapped),
    inputSchema: wrapJsonSchema(inputWire.schema),
    outputSchema: spec.outputSchema ? wrapJsonSchema(spec.outputSchema) : undefined,
    providerOptions: spec.providerOptions,
  }
}

/**
 * @deprecated Use actionsToActionSpecs.
 */
export const toolsToModelTools = actionsToActionSpecs






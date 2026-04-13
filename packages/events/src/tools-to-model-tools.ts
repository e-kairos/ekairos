import { asSchema, type Tool } from "ai"

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
  return (
    Boolean(tool) &&
    typeof tool === "object" &&
    (tool as any).type === "provider-defined" &&
    typeof (tool as any).id === "string" &&
    (tool as any).id.trim().length > 0
  )
}

/**
 * Convert AI SDK tools to a serializable representation that can be passed to `"use-step"` functions.
 *
 * This matches DurableAgent's internal `toolsToModelTools` behavior:
 * `inputSchema: asSchema(tool.inputSchema).jsonSchema`
 */
export function actionsToActionSpecs(
  tools: Record<string, Tool>,
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

    const inputSchema = (tool as any)?.inputSchema
    if (!inputSchema) {
      throw new Error(
        `Context: tool "${name}" is missing inputSchema (required for model tool calls)`,
      )
    }
    out[name] = {
      type: "function",
      description: (tool as any)?.description,
      inputSchema: asSchema(inputSchema).jsonSchema,
      providerOptions: (tool as any)?.providerOptions,
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

  return {
    type: "function" as const,
    description: spec.description,
    inputSchema: wrapJsonSchema(spec.inputSchema),
    providerOptions: spec.providerOptions,
  }
}

/**
 * @deprecated Use actionsToActionSpecs.
 */
export const toolsToModelTools = actionsToActionSpecs






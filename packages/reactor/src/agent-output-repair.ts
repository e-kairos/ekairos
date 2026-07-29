import type { ModelMessage } from "ai"
import { z } from "zod"

export const DEFAULT_AGENT_REPAIR_RETRIES = 2
const MAX_DIAGNOSTIC_RESPONSE_LENGTH = 2_000

export type AgentWireValidationKind =
  | "action_input"
  | "empty_response"
  | "malformed_response"
  | "output"

export type AgentWireValidationFailure = Readonly<{
  kind: AgentWireValidationKind
  target: string
  validation: string
  expectedSchema: unknown
  response: unknown
}>

export function resolveAgentRepairRetries(value: number | undefined) {
  const retries = value ?? DEFAULT_AGENT_REPAIR_RETRIES
  if (!Number.isInteger(retries) || retries < 0) {
    throw new Error("reaction_agent_repair_retries_invalid")
  }
  return retries
}

export function schemaValidationFailure(input: {
  kind: AgentWireValidationKind
  target: string
  schema: z.ZodType
  value: unknown
}): AgentWireValidationFailure | undefined {
  const parsed = input.schema.safeParse(input.value)
  if (parsed.success) return undefined
  return Object.freeze({
    kind: input.kind,
    target: input.target,
    validation: formatZodError(parsed.error),
    expectedSchema: jsonSchema(input.schema),
    response: input.value,
  })
}

export function agentWireValidationFailure(input: {
  kind: AgentWireValidationKind
  target: string
  validation: string
  expectedSchema: unknown
  response: unknown
}): AgentWireValidationFailure {
  return Object.freeze({ ...input })
}

export function agentRepairMessage(
  failure: AgentWireValidationFailure,
  retry: number,
  maxRetries: number,
): ModelMessage {
  return {
    role: "user",
    content: [{
      type: "text",
      text: [
        `The previous model response failed wire validation for "${failure.target}".`,
        `Validation error:\n${failure.validation}`,
        `Expected JSON Schema:\n${stableJson(failure.expectedSchema)}`,
        `Previous response:\n${diagnosticResponse(failure.response)}`,
        `Repair attempt ${retry} of ${maxRetries}. Return a corrected response only. Do not rename fields or invent replacement keys.`,
      ].join("\n\n"),
    }],
  } as ModelMessage
}

export function agentWireError(
  code: "reaction_agent_output_not_delivered" | "reaction_agent_repair_exhausted",
  input: {
    maxRounds?: number
    repairsUsed: number
    repairRetries: number
    failure?: AgentWireValidationFailure
    response?: unknown
  },
) {
  const validation = input.failure?.validation ?? "none"
  const response = diagnosticResponse(input.failure?.response ?? input.response)
  return new Error([
    code,
    input.maxRounds === undefined ? undefined : `maxRounds=${input.maxRounds}`,
    `repairs=${input.repairsUsed}/${input.repairRetries}`,
    `lastValidation=${validation}`,
    `lastResponse=${response}`,
  ].filter(Boolean).join(":"))
}

export function diagnosticResponse(value: unknown) {
  const rendered = typeof value === "string" ? value : stableJson(value)
  if (rendered.length <= MAX_DIAGNOSTIC_RESPONSE_LENGTH) return rendered
  return `${rendered.slice(0, MAX_DIAGNOSTIC_RESPONSE_LENGTH)}...[truncated]`
}

export function formatZodError(error: z.ZodError) {
  return error.issues.map(issue => {
    const path = issue.path.length > 0
      ? issue.path.map(segment => String(segment)).join(".")
      : "<root>"
    return `${path}: ${issue.message} (${issue.code})`
  }).join("\n")
}

function jsonSchema(schema: z.ZodType) {
  try {
    return z.toJSONSchema(schema, { target: "draft-7" })
  } catch {
    return { description: "Schema could not be serialized; use the validation paths exactly." }
  }
}

function stableJson(value: unknown) {
  try {
    const rendered = JSON.stringify(sortJson(value), null, 2)
    return rendered === undefined ? String(value) : rendered
  } catch {
    return String(value)
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  )
}

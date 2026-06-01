import { z } from "zod"

export type TaskState = "open" | "completed" | "cancelled" | "failed"

export type TaskStoredOutcomeSchema = {
  type: "json-schema"
  schema: unknown
}

export type TaskData<TContext = unknown, TOutcome = unknown> = {
  id: string
  kind: string
  key: string
  state: TaskState
  instructions: string
  context: TContext
  outcomeKind?: string
  outcomeSchema?: TaskStoredOutcomeSchema
  resolvedOutcome?: TOutcome
  createdAt?: Date | string
  updatedAt?: Date | string
  resolvedAt?: Date | string
}

export type TaskHandle<TOutcome, TContext = unknown> =
  & TaskData<TContext, TOutcome>
  & {
    outcome(): Promise<TOutcome>
  }

export type TaskOutcomeSchema<TOutcome> = z.ZodType<TOutcome>

function assertNonEmpty(value: string, name: string) {
  if (!value.trim()) {
    throw new Error(`${name} is required.`)
  }
}

export function taskOutcomeToken(id: string) {
  assertNonEmpty(id, "Task id")
  return `ekairos_task:outcome:${id}`
}

export function parseTaskOutcome<TOutcome>(
  outcomeSchema: TaskOutcomeSchema<TOutcome>,
  outcome: unknown,
): TOutcome {
  return outcomeSchema.parse(outcome) as TOutcome
}

export function toStoredOutcomeSchema<TOutcome>(
  outcomeSchema: TaskOutcomeSchema<TOutcome>,
): TaskStoredOutcomeSchema {
  return {
    type: "json-schema",
    schema: z.toJSONSchema(outcomeSchema as never, { target: "draft-7" }),
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  )
}

function schemaFingerprint(schema: unknown): string {
  return JSON.stringify(sortJson(schema))
}

export function storedOutcomeSchemaMatches<TOutcome>(
  outcomeSchema: TaskOutcomeSchema<TOutcome>,
  storedSchema: TaskStoredOutcomeSchema | undefined,
): boolean {
  return storedOutcomeSchemasEqual(toStoredOutcomeSchema(outcomeSchema), storedSchema)
}

export function storedOutcomeSchemasEqual(
  left: TaskStoredOutcomeSchema | undefined,
  right: TaskStoredOutcomeSchema | undefined,
): boolean {
  if (!left || !right || left.type !== "json-schema" || right.type !== "json-schema") {
    return false
  }

  return schemaFingerprint(left.schema) === schemaFingerprint(right.schema)
}

export function assertStoredOutcomeSchemaMatches<TOutcome>(
  outcomeSchema: TaskOutcomeSchema<TOutcome>,
  storedSchema: TaskStoredOutcomeSchema | undefined,
) {
  if (!storedOutcomeSchemaMatches(outcomeSchema, storedSchema)) {
    throw new Error("Task outcome schema does not match the stored task outcome schema.")
  }
}

type TaskHandleOptions<TOutcome, TContext> = {
  awaitOutcome?: () => Promise<unknown>
}

export function createTaskHandle<TOutcome, TContext = unknown>(
  data: TaskData<TContext, TOutcome>,
  outcomeSchema: TaskOutcomeSchema<TOutcome>,
  options: TaskHandleOptions<TOutcome, TContext> = {},
): TaskHandle<TOutcome, TContext> {
  assertNonEmpty(data.id, "Task id")
  assertNonEmpty(data.kind, "Task kind")
  assertNonEmpty(data.key, "Task key")

  return {
    ...data,
    async outcome() {
      if (options.awaitOutcome) {
        return parseTaskOutcome(outcomeSchema, await options.awaitOutcome())
      }

      if (data.state === "completed") {
        return parseTaskOutcome(outcomeSchema, data.resolvedOutcome)
      }

      throw new Error(`Task ${data.id} cannot resolve an outcome without an awaitOutcome action.`)
    },
  }
}

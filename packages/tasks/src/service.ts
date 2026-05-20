import Ajv from "ajv"
import { id as instantId } from "@instantdb/core"
import { createHook } from "workflow"

import { approvalOutcomeSchema } from "./approval.js"
import { tasksDomain } from "./domain.js"
import {
  assertStoredOutcomeSchemaMatches,
  createTaskHandle,
  storedOutcomeSchemasEqual,
  taskOutcomeToken,
  toStoredOutcomeSchema,
  type TaskData,
  type TaskHandle,
  type TaskOutcomeSchema,
  type TaskState,
  type TaskStoredOutcomeSchema,
} from "./task.js"

export type ServiceResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues?: unknown }

export type TasksRuntime = {
  use(domain: unknown): Promise<any>
}

export type TaskRecord<TContext = unknown, TOutcome = unknown> =
  & TaskData<TContext, TOutcome>
  & {
    errorText?: string
  }

export type TaskOpenActionInput = {
  id?: string
  kind: string
  key: string
  instructions: string
  context?: unknown
  outcomeKind?: string
  outcomeSchema: TaskStoredOutcomeSchema
}

export type TaskDecideActionInput = {
  id: string
  outcome: unknown
  resumeWorkflow?: boolean
}

export type TaskCancelActionInput = {
  id: string
  reason?: string
}

export type TaskFailActionInput = {
  id: string
  errorText: string
}

export type TaskGetActionInput = {
  id: string
}

export type TaskAwaitOutcomeActionInput = {
  id: string
}

export type TaskOpenOptions = {
  id?: string
  outcomeKind?: string
}

export type TaskOpenInput<TOutcome, TContext = unknown> = {
  id?: string
  kind: string
  key: string
  outcome: TaskOutcomeSchema<TOutcome>
  instructions: string
  context: TContext
  outcomeKind?: string
}

export type TaskApprovalInput<TContext = unknown> = {
  id?: string
  key: string
  instructions: string
  context: TContext
}

async function runTaskDomainAction(
  runtime: TasksRuntime,
  action: keyof typeof tasksDomain.actions,
  input: unknown,
) {
  const tasks = await tasksDomain(runtime)
  const actions = tasks as Record<
    keyof typeof tasksDomain.actions,
    (input: unknown) => Promise<unknown>
  >
  return await actions[action](input)
}

function unwrapTaskResult(result: ServiceResult<TaskRecord>): TaskRecord {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

async function getTaskRecordThroughDomain(
  runtime: TasksRuntime,
  id: string,
): Promise<TaskRecord> {
  return unwrapTaskResult(
    await runTaskDomainAction(runtime, "getTask", { id }) as ServiceResult<TaskRecord>,
  )
}

function unwrapOutcomeResult(result: ServiceResult<unknown>): unknown {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

function createDomainTaskHandle<TOutcome, TContext = unknown>(
  runtime: TasksRuntime,
  record: TaskRecord<TContext, TOutcome>,
  outcomeSchema: TaskOutcomeSchema<TOutcome>,
): TaskHandle<TOutcome, TContext> {
  assertStoredOutcomeSchemaMatches(outcomeSchema, record.outcomeSchema)

  return createTaskHandle(record, outcomeSchema, {
    async awaitOutcome() {
      return unwrapOutcomeResult(
        await runTaskDomainAction(
          runtime,
          "awaitOutcome",
          { id: record.id },
        ) as ServiceResult<unknown>,
      )
    },
  })
}

let ajvInstance: Ajv | null = null

function getAjv() {
  if (!ajvInstance) {
    ajvInstance = new Ajv({ allErrors: true, strict: false })
  }
  return ajvInstance
}

function newEntityId() {
  return instantId()
}

function normalizeTaskState(state: unknown): TaskState {
  if (
    state === "open" ||
    state === "completed" ||
    state === "cancelled" ||
    state === "failed"
  ) {
    return state
  }
  return "open"
}

function rowToTaskRecord<TContext = unknown, TOutcome = unknown>(
  row: Record<string, any>,
): TaskRecord<TContext, TOutcome> {
  return {
    id: String(row.id),
    kind: String(row.kind),
    key: String(row.key),
    state: normalizeTaskState(row.state),
    instructions: String(row.instructions ?? ""),
    context: row.context as TContext,
    outcomeKind: typeof row.outcomeKind === "string" ? row.outcomeKind : undefined,
    outcomeSchema: row.outcomeSchema as TaskStoredOutcomeSchema | undefined,
    resolvedOutcome: row.outcome as TOutcome,
    errorText: typeof row.errorText === "string" ? row.errorText : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  }
}

function validateStoredOutcome(
  storedSchema: TaskStoredOutcomeSchema | undefined,
  outcome: unknown,
): ServiceResult<unknown> {
  if (!storedSchema || storedSchema.type !== "json-schema") {
    return { ok: false, error: "task_outcome_schema_missing" }
  }

  try {
    const validate = getAjv().compile(storedSchema.schema as any)
    if (!validate(outcome)) {
      return {
        ok: false,
        error: "task_outcome_invalid",
        issues: validate.errors ?? [],
      }
    }
  } catch (error) {
    return {
      ok: false,
      error: "task_outcome_schema_invalid",
      issues: error instanceof Error ? error.message : String(error),
    }
  }

  return { ok: true, data: outcome }
}

async function resumeTaskOutcome<TOutcome>(id: string, outcome: TOutcome) {
  const { resumeHook } = await import("workflow/api")
  try {
    await resumeHook(taskOutcomeToken(id), outcome)
  } catch (error) {
    if (error instanceof Error && error.name === "HookNotFoundError") {
      return
    }
    throw error
  }
}

function createTaskOutcomeHook<TOutcome>(id: string) {
  return createHook<TOutcome>({
    token: taskOutcomeToken(id),
  })
}

export class TaskService {
  constructor(private readonly runtime: TasksRuntime) {}

  private async scoped() {
    return await this.runtime.use(tasksDomain)
  }

  private async db(): Promise<any> {
    const scoped = await this.scoped()
    return scoped.db as any
  }

  private async getTaskRecord(id: string): Promise<TaskRecord | null> {
    const db = await this.db()
    const result = await db.query({
      task_tasks: {
        $: { where: { id }, limit: 1 },
      },
    })
    const row = result?.task_tasks?.[0]
    return row?.id ? rowToTaskRecord(row) : null
  }

  async openRaw(input: TaskOpenActionInput): Promise<ServiceResult<TaskRecord>> {
    if (!input.kind.trim()) return { ok: false, error: "task_kind_required" }
    if (!input.key.trim()) return { ok: false, error: "task_key_required" }
    if (!input.outcomeSchema) return { ok: false, error: "task_outcome_schema_required" }

    const db = await this.db()
    const existing = await db.query({
      task_tasks: {
        $: { where: { key: input.key }, limit: 1 },
      },
    })
    const existingTask = existing?.task_tasks?.[0]
    if (existingTask?.id) {
      const existingSchema = existingTask.outcomeSchema as TaskStoredOutcomeSchema | undefined
      if (!storedOutcomeSchemasEqual(existingSchema, input.outcomeSchema)) {
        return { ok: false, error: "task_outcome_schema_mismatch" }
      }
      return { ok: true, data: rowToTaskRecord(existingTask) }
    }

    const now = new Date()
    const id = input.id ?? newEntityId()
    await db.transact([
      db.tx.task_tasks[id].update({
        kind: input.kind,
        key: input.key,
        state: "open",
        instructions: input.instructions,
        context: input.context,
        outcomeKind: input.outcomeKind,
        outcomeSchema: input.outcomeSchema,
        createdAt: now,
        updatedAt: now,
      }),
    ])

    const created = await this.getTaskRecord(id)
    if (!created) return { ok: false, error: "task_open_failed" }
    return { ok: true, data: created }
  }

  async decide(input: TaskDecideActionInput): Promise<ServiceResult<TaskRecord>> {
    if (!input.id.trim()) return { ok: false, error: "task_id_required" }

    const task = await this.getTaskRecord(input.id)
    if (!task) return { ok: false, error: "task_not_found" }
    if (task.state !== "open") {
      return { ok: false, error: `task_not_open:${task.state}` }
    }

    const validation = validateStoredOutcome(task.outcomeSchema, input.outcome)
    if (!validation.ok) return validation

    const db = await this.db()
    const now = new Date()
    await db.transact([
      db.tx.task_tasks[input.id].update({
        state: "completed",
        outcome: validation.data,
        resolvedAt: now,
        updatedAt: now,
      }),
    ])

    if (input.resumeWorkflow !== false) {
      await resumeTaskOutcome(input.id, validation.data)
    }

    const completed = await this.getTaskRecord(input.id)
    if (!completed) return { ok: false, error: "task_not_found_after_decide" }
    return { ok: true, data: completed }
  }

  async cancel(input: TaskCancelActionInput): Promise<ServiceResult<TaskRecord>> {
    if (!input.id.trim()) return { ok: false, error: "task_id_required" }

    const task = await this.getTaskRecord(input.id)
    if (!task) return { ok: false, error: "task_not_found" }
    if (task.state !== "open") {
      return { ok: false, error: `task_not_open:${task.state}` }
    }

    const db = await this.db()
    const now = new Date()
    await db.transact([
      db.tx.task_tasks[input.id].update({
        state: "cancelled",
        errorText: input.reason,
        resolvedAt: now,
        updatedAt: now,
      }),
    ])

    const cancelled = await this.getTaskRecord(input.id)
    if (!cancelled) return { ok: false, error: "task_not_found_after_cancel" }
    return { ok: true, data: cancelled }
  }

  async fail(input: TaskFailActionInput): Promise<ServiceResult<TaskRecord>> {
    if (!input.id.trim()) return { ok: false, error: "task_id_required" }
    if (!input.errorText.trim()) return { ok: false, error: "task_error_text_required" }

    const task = await this.getTaskRecord(input.id)
    if (!task) return { ok: false, error: "task_not_found" }
    if (task.state !== "open") {
      return { ok: false, error: `task_not_open:${task.state}` }
    }

    const db = await this.db()
    const now = new Date()
    await db.transact([
      db.tx.task_tasks[input.id].update({
        state: "failed",
        errorText: input.errorText,
        resolvedAt: now,
        updatedAt: now,
      }),
    ])

    const failed = await this.getTaskRecord(input.id)
    if (!failed) return { ok: false, error: "task_not_found_after_fail" }
    return { ok: true, data: failed }
  }

  async getRaw(input: TaskGetActionInput): Promise<ServiceResult<TaskRecord>> {
    if (!input.id.trim()) return { ok: false, error: "task_id_required" }

    const task = await this.getTaskRecord(input.id)
    if (!task) return { ok: false, error: "task_not_found" }
    return { ok: true, data: task }
  }

  async awaitOutcome(
    input: TaskAwaitOutcomeActionInput,
  ): Promise<ServiceResult<unknown>> {
    if (!input.id.trim()) return { ok: false, error: "task_id_required" }

    const task = await this.getTaskRecord(input.id)
    if (!task) return { ok: false, error: "task_not_found" }

    if (task.state === "completed") {
      return validateStoredOutcome(task.outcomeSchema, task.resolvedOutcome)
    }

    if (task.state !== "open") {
      return { ok: false, error: `task_not_open:${task.state}` }
    }

    const hook = createTaskOutcomeHook<unknown>(input.id)
    try {
      return validateStoredOutcome(task.outcomeSchema, await hook)
    } finally {
      hook.dispose()
    }
  }

}

export class Task {
  static async open<TOutcome, TContext = unknown>(
    runtime: TasksRuntime,
    input: TaskOpenInput<TOutcome, TContext>,
  ): Promise<TaskHandle<TOutcome, TContext>> {
    const opened = unwrapTaskResult(
      await runTaskDomainAction(runtime, "openTask", {
        id: input.id,
        kind: input.kind,
        key: input.key,
        instructions: input.instructions,
        context: input.context,
        outcomeKind: input.outcomeKind,
        outcomeSchema: toStoredOutcomeSchema(input.outcome),
      }) as ServiceResult<TaskRecord>,
    )
    return createDomainTaskHandle(
      runtime,
      opened as TaskRecord<TContext, TOutcome>,
      input.outcome,
    )
  }

  static async approval<TContext = unknown>(
    runtime: TasksRuntime,
    input: TaskApprovalInput<TContext>,
  ) {
    return await Task.open(runtime, {
      id: input.id,
      kind: "approval",
      key: input.key,
      outcome: approvalOutcomeSchema,
      instructions: input.instructions,
      context: input.context,
      outcomeKind: "approval",
    })
  }

  static async get<TOutcome, TContext = unknown>(
    runtime: TasksRuntime,
    id: string,
    outcomeSchema: TaskOutcomeSchema<TOutcome>,
  ): Promise<TaskHandle<TOutcome, TContext>> {
    const task = await getTaskRecordThroughDomain(runtime, id)
    return createDomainTaskHandle(
      runtime,
      task as TaskRecord<TContext, TOutcome>,
      outcomeSchema,
    )
  }
}

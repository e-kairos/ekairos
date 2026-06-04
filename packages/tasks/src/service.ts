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
  type TaskRunHandle,
  type TaskState,
  type TaskStoredOutcomeSchema,
} from "./task.js"

export type ServiceResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues?: unknown }

export type TasksRuntime = {
  db: any
}

export type TasksClientRuntime = {
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
  runId?: string
}

export type TaskCancelActionInput = {
  id: string
  reason?: string
  runId?: string
}

export type TaskFailActionInput = {
  id: string
  errorText: string
  runId?: string
}

export type TaskStartActionInput = {
  id: string
  runId: string
}

export type TaskReleaseActionInput = {
  id: string
  runId: string
  actor?: unknown
  comment?: string
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
  runtime: TasksClientRuntime,
  action: keyof typeof tasksDomain.actions,
  input: unknown,
) {
  const tasks = await tasksDomain(runtime)
  const actions = tasks.actions as Record<
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
  runtime: TasksClientRuntime,
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

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function createDomainTaskHandle<TOutcome, TContext = unknown>(
  runtime: TasksClientRuntime,
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
    async start(data, work) {
      const runId = newEntityId()
      let terminal = false
      let lastRecord: TaskRecord<TContext, TOutcome> | null = null

      const completeWith = async (outcome: TOutcome) => {
        lastRecord = unwrapTaskResult(
          await runTaskDomainAction(runtime, "completeTask", {
            id: data.id,
            runId,
            outcome,
          }) as ServiceResult<TaskRecord>,
        ) as TaskRecord<TContext, TOutcome>
        terminal = true
        return lastRecord
      }

      const releaseWith = async (input?: { actor?: unknown; comment?: string }) => {
        lastRecord = unwrapTaskResult(
          await runTaskDomainAction(runtime, "releaseTask", {
            id: data.id,
            runId,
            actor: input?.actor,
            comment: input?.comment,
          }) as ServiceResult<TaskRecord>,
        ) as TaskRecord<TContext, TOutcome>
        terminal = true
        return lastRecord
      }

      await runTaskDomainAction(runtime, "startTask", {
        id: data.id,
        runId,
      })

      const run: TaskRunHandle<TOutcome> = {
        id: runId,
        taskId: data.id,
        completed: completeWith,
        release: releaseWith,
      }

      try {
        const returned = await work(run)
        if (returned) {
          if (returned.state === "in_progress") {
            throw new Error(
              "Task.start callback returned an in_progress task. A started task must finish with completed outcome or release.",
            )
          }
          return returned
        }
        if (!terminal) {
          throw new Error(
            "Task.start callback finished without completing or releasing the task.",
          )
        }
        if (!lastRecord) {
          throw new Error("Task.start callback did not return a task record.")
        }
        return lastRecord
      } catch (error) {
        if (!terminal) {
          try {
            await runTaskDomainAction(runtime, "failTask", {
              id: data.id,
              runId,
              errorText: errorText(error),
            })
          } catch {
            // Preserve the original runner failure.
          }
        }
        throw error
      }
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
    state === "in_progress" ||
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
    activeRunId: typeof row.activeRunId === "string" ? row.activeRunId : undefined,
    lastProgress: row.lastProgress,
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

async function resumeTaskFailure(id: string, error: string) {
  const { resumeHook } = await import("workflow/api")
  try {
    await resumeHook(taskOutcomeToken(id), {
      __ekairosTaskFailure: true,
      error,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "HookNotFoundError") {
      return
    }
    throw error
  }
}

function failureOutcomeError(task: TaskRecord) {
  if (task.state === "failed") {
    return task.errorText || "task_failed"
  }
  if (task.state === "cancelled") {
    return task.errorText || "task_cancelled"
  }
  return `task_not_open:${task.state}`
}

function isFailureHookPayload(value: unknown): value is {
  __ekairosTaskFailure: true
  error?: unknown
} {
  return !!value &&
    typeof value === "object" &&
    (value as { __ekairosTaskFailure?: unknown }).__ekairosTaskFailure === true
}

function createTaskOutcomeHook<TOutcome>(id: string) {
  return createHook<TOutcome>({
    token: taskOutcomeToken(id),
  })
}

export class TaskService {
  constructor(private readonly runtime: TasksRuntime) {}

  private db(): any {
    return this.runtime.db as any
  }

  private async getTaskRecord(id: string): Promise<TaskRecord | null> {
    const db = this.db()
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

    const db = this.db()
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
    if (task.state !== "open" && task.state !== "in_progress") {
      return { ok: false, error: `task_not_decidable:${task.state}` }
    }
    if (task.state === "in_progress" && !input.runId?.trim()) {
      return { ok: false, error: "task_run_id_required" }
    }
    if (task.state === "in_progress" && task.activeRunId !== input.runId) {
      return { ok: false, error: "task_run_mismatch" }
    }

    const validation = validateStoredOutcome(task.outcomeSchema, input.outcome)
    if (!validation.ok) return validation

    const db = this.db()
    const now = new Date()
    await db.transact([
      db.tx.task_tasks[input.id].update({
        state: "completed",
        activeRunId: "",
        outcome: validation.data,
        lastProgress: {
          type: "completed",
          runId: input.runId,
          createdAt: now.toISOString(),
        },
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
    if (task.state !== "open" && task.state !== "in_progress") {
      return { ok: false, error: `task_not_cancellable:${task.state}` }
    }
    if (task.state === "in_progress" && !input.runId?.trim()) {
      return { ok: false, error: "task_run_id_required" }
    }
    if (task.state === "in_progress" && task.activeRunId !== input.runId) {
      return { ok: false, error: "task_run_mismatch" }
    }

    const db = this.db()
    const now = new Date()
    await db.transact([
      db.tx.task_tasks[input.id].update({
        state: "cancelled",
        activeRunId: "",
        errorText: input.reason,
        lastProgress: {
          type: "cancelled",
          runId: input.runId,
          comment: input.reason,
          createdAt: now.toISOString(),
        },
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
    if (task.state !== "open" && task.state !== "in_progress") {
      return { ok: false, error: `task_not_failable:${task.state}` }
    }
    if (task.state === "in_progress" && !input.runId?.trim()) {
      return { ok: false, error: "task_run_id_required" }
    }
    if (task.state === "in_progress" && task.activeRunId !== input.runId) {
      return { ok: false, error: "task_run_mismatch" }
    }

    const db = this.db()
    const now = new Date()
    await db.transact([
      db.tx.task_tasks[input.id].update({
        state: "failed",
        activeRunId: "",
        errorText: input.errorText,
        lastProgress: {
          type: "failed",
          runId: input.runId,
          comment: input.errorText,
          createdAt: now.toISOString(),
        },
        resolvedAt: now,
        updatedAt: now,
      }),
    ])

    await resumeTaskFailure(input.id, input.errorText)

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

    if (task.state === "failed" || task.state === "cancelled") {
      return { ok: false, error: failureOutcomeError(task) }
    }

    if (task.state !== "open" && task.state !== "in_progress") {
      return { ok: false, error: `task_not_open:${task.state}` }
    }

    const hook = createTaskOutcomeHook<unknown>(input.id)
    try {
      const outcome = await hook
      if (isFailureHookPayload(outcome)) {
        return { ok: false, error: String(outcome.error || "task_failed") }
      }
      return validateStoredOutcome(task.outcomeSchema, outcome)
    } finally {
      hook.dispose()
    }
  }

  async start(input: TaskStartActionInput): Promise<ServiceResult<TaskRecord>> {
    if (!input.id.trim()) return { ok: false, error: "task_id_required" }
    if (!input.runId.trim()) return { ok: false, error: "task_run_id_required" }

    const task = await this.getTaskRecord(input.id)
    if (!task) return { ok: false, error: "task_not_found" }
    if (task.state !== "open") {
      return { ok: false, error: `task_not_open:${task.state}` }
    }

    const db = this.db()
    const now = new Date()
    await db.transact([
      db.tx.task_tasks[input.id].update({
        state: "in_progress",
        activeRunId: input.runId,
        lastProgress: {
          type: "started",
          runId: input.runId,
          createdAt: now.toISOString(),
        },
        updatedAt: now,
      }),
    ])

    const started = await this.getTaskRecord(input.id)
    if (!started) return { ok: false, error: "task_not_found_after_start" }
    return { ok: true, data: started }
  }

  async release(input: TaskReleaseActionInput): Promise<ServiceResult<TaskRecord>> {
    if (!input.id.trim()) return { ok: false, error: "task_id_required" }
    if (!input.runId.trim()) return { ok: false, error: "task_run_id_required" }

    const task = await this.getTaskRecord(input.id)
    if (!task) return { ok: false, error: "task_not_found" }
    if (task.state !== "in_progress") {
      return { ok: false, error: `task_not_in_progress:${task.state}` }
    }
    if (task.activeRunId !== input.runId) {
      return { ok: false, error: "task_run_mismatch" }
    }

    const db = this.db()
    const now = new Date()
    await db.transact([
      db.tx.task_tasks[input.id].update({
        state: "open",
        activeRunId: "",
        lastProgress: {
          type: "released",
          runId: input.runId,
          actor: input.actor,
          comment: input.comment?.trim() || undefined,
          createdAt: now.toISOString(),
        },
        updatedAt: now,
      }),
    ])

    const released = await this.getTaskRecord(input.id)
    if (!released) return { ok: false, error: "task_not_found_after_release" }
    return { ok: true, data: released }
  }

}

export class Task {
  static async create<TOutcome, TContext = unknown>(
    runtime: TasksClientRuntime,
    input: TaskOpenInput<TOutcome, TContext>,
  ): Promise<TaskHandle<TOutcome, TContext>> {
    return await Task.open(runtime, input)
  }

  static async open<TOutcome, TContext = unknown>(
    runtime: TasksClientRuntime,
    input: TaskOpenInput<TOutcome, TContext>,
  ): Promise<TaskHandle<TOutcome, TContext>> {
    const opened = unwrapTaskResult(
      await runTaskDomainAction(runtime, "createTask", {
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
    runtime: TasksClientRuntime,
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
    runtime: TasksClientRuntime,
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

import type { ModelMessage, UIMessageChunk } from "ai"
import type { DomainSchemaResult } from "@ekairos/domain"

import type { ContextEnvironment } from "./context.config.js"
import type { ContextTool } from "./context.action.js"
import type {
  ContextRuntime,
  ContextRuntimeHandleForDomain,
  ContextRuntimeForDomain,
} from "./context.runtime.js"
import { getContextRuntimeServices } from "./context.runtime.js"
import { eventsDomain } from "./schema.js"
import type {
  ContextExecution,
  ContextItem,
  ContextIdentifier,
  ContextExecutionParent,
  StoredContext,
} from "./context.store.js"
import { OUTPUT_ITEM_TYPE, WEB_CHANNEL } from "./context.events.js"
import { applyToolExecutionResultToParts } from "./context.toolcalls.js"
import {
  isContextPartEnvelope,
  normalizePartsForPersistence,
} from "./context.parts.js"
import type { ContextStreamEvent } from "./context.stream.js"

import type { ContextSkillPackage } from "./context.skill.js"
import {
  createAiSdkReactor,
  type ContextReactor,
} from "./context.reactor.js"
import {
  abortPersistedContextStepStream,
  closeContextStream,
  createPersistedContextStepStreamForRuntime,
  finalizePersistedContextStepStreamForRuntime,
  writeActionResultPartChunksToSession,
  type PersistedContextStepStreamSession,
} from "./steps/stream.steps.js"
import {
  completeExecution,
  completeExecutionStep,
  createContextStep,
  getContextItems,
  initializeContext,
  openExecutionStep,
  openExecution,
  saveExecutionStepOutput,
  updateContextContent,
  updateContextReactor,
  updateContextStatus,
  updateItem,
  updateContextStep,
  updateExecutionWorkflowRun,
} from "./steps/store.steps.js"
import {
  getClientResumeHookUrl,
  toolApprovalHookToken,
  toolApprovalWebhookToken,
} from "./context.hooks.js"

export interface ContextOptions<
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> {
  onContextCreated?: (args: {
    env: Env
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>
    context: StoredContext<Context>
  }) => void | Promise<void>
  onContextUpdated?: (args: {
    env: Env
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>
    context: StoredContext<Context>
  }) => void | Promise<void>
  onEventCreated?: (event: ContextItem) => void | Promise<void>
  onActionExecuted?: (executionEvent: any) => void | Promise<void>
  onEnd?: (
    lastEvent: ContextItem,
  ) => void | boolean | Promise<void | boolean>
}

type ContextBenchmarkRecorder = {
  measure<T>(name: string, run: () => Promise<T> | T): Promise<T>
  add?(name: string, value: number): void
  getCurrentStage?(): string | undefined
}

export interface ContextStreamOptions {
  /**
   * If true, we do not close the writable stream.
   * Default: false.
   */
  preventClose?: boolean

  /**
   * If true, we write a `finish` chunk to the stream.
   * Default: true.
   */
  sendFinish?: boolean

  /**
   * Optional writable stream used by explicit execution.
   */
  writable?: WritableStream<UIMessageChunk>
}

/**
 * Model initializer (DurableAgent-style).
 *
 * - `string`: Vercel AI Gateway model id (e.g. `"openai/gpt-5"`), resolved inside the LLM step.
 * - `function`: a function that returns a model instance. For Workflow compatibility, this should
 *   be a `"use-step"` function (so it can be serialized by reference).
 */
export type ContextModelInit = string | (() => Promise<any>)

export type ContextReactParams<
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = {
  runtime: ContextRuntimeForDomain<Runtime, RequiredDomain>
  /**
   * Context selector (exclusive: `{ id }` OR `{ key }`).
   * - `{ id }` resolves a concrete context id.
   * - `{ key }` resolves by `context.key`.
   * If omitted/null, the story will create a new context.
   */
  context?: ContextIdentifier | null
  parent?: ContextExecutionParent
  options?: ContextStreamOptions
  /**
   * Internal bootstrap used by the workflow-owned continuation path.
   * Not part of the public API surface.
   */
  __bootstrap?: {
    contextId: string
    trigger: ContextItem
    reaction: ContextItem
    execution: ContextExecution
    returnValueHookToken?: string | null
  }
  __initialContent?: unknown
  __benchmark?: ContextBenchmarkRecorder
}

async function resolveReactRuntime<
  Env extends ContextEnvironment,
  RequiredDomain extends DomainSchemaResult,
  Runtime extends ContextRuntime<Env>,
>(
  params: ContextReactParams<Env, RequiredDomain, Runtime>,
): Promise<ContextRuntimeForDomain<Runtime, RequiredDomain>> {
  if (params.runtime) return params.runtime
  throw new Error("ContextEngine.react requires runtime.")
}

export type ContextReactBase<Context = any> = {
  context: StoredContext<Context>
  trigger: ContextItem
  reaction: ContextItem
  execution: ContextExecution
}

export type ContextReactFinalResult<Context = any> = ContextReactBase<Context>

export type ContextDirectRun<Context = any> = Promise<ContextReactFinalResult<Context>>

export type ContextReactRun<Context = any> = ContextDirectRun<Context>

export type ContextReactResult<
  Context = any,
  Run extends ContextReactRun<Context> = ContextReactRun<Context>,
> = ContextReactBase<Context> & {
  run?: Run
}

export type ContextExecutionActionResult = {
  actionRequest: {
    actionRef: string
    actionName: string
    input: unknown
  }
  success: boolean
  output: unknown
  errorText?: string
}

export type ContextExecutionPromptOptions<
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> = {
  instructions?: string
  actions?: Record<string, ContextTool<Context, Env, RequiredDomain>>
  skills?: ContextSkillPackage[]
  reactor?: ContextReactor<Context, Env, RequiredDomain>
  maxModelSteps?: number
}

export type ContextExecutionPromptResult = {
  stepId: string
  parts: any[]
  actionRequests: Array<{
    actionRef: string
    actionName: string
    input: unknown
  }>
  actionResults: ContextExecutionActionResult[]
  reaction: ContextItem
}

export type ContextExecutionEndInput =
  | void
  | null
  | string
  | {
      message?: string
      parts?: any[]
      status?: "completed" | "failed"
    }

export type ContextExecutionHandle<
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> = {
  readonly contextId: string
  readonly executionId: string
  readonly triggerEventId: string
  readonly reactionEventId: string
  readonly state: StoredContext<Context>
  context(content: Context): Promise<StoredContext<Context>>
  prompt(
    name: string,
    options?: ContextExecutionPromptOptions<Context, Env, RequiredDomain>,
  ): Promise<ContextExecutionPromptResult>
  end(input?: ContextExecutionEndInput): Promise<ContextReactFinalResult<Context>>
}

export type ContextExecutionHandler<
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> = (
  execution: ContextExecutionHandle<Context, Env, RequiredDomain>,
) => Promise<unknown> | unknown

export type ContextToolExecuteContext<
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = {
  runtime: ContextRuntimeForDomain<Runtime, RequiredDomain>
  context: StoredContext<Context>
  contextIdentifier: ContextIdentifier
  toolCallId: string
  messages: ModelMessage[]
  eventId: string
  executionId: string
  triggerEventId: string
  contextId: string
  stepId: string
  iteration: number
  contextStepStream?: WritableStream<string>
}

/**
 * Payload expected to resume an auto=false tool execution.
 *
 * This must be serializable because it crosses the workflow hook boundary.
 *
 * See: https://useworkflow.dev/docs/foundations/hooks
 */
type ContextToolApprovalPayload =
  | { approved: true; comment?: string; args?: Record<string, unknown> }
  | { approved: false; comment?: string }

export { toolApprovalHookToken, toolApprovalWebhookToken, getClientResumeHookUrl }

/**
 * Context-level tool type.
 *
 * Allows contexts to attach metadata to actions/tools (e.g. `{ auto: false }`)
 * while remaining compatible with the AI SDK `Tool` runtime shape.
 *
 * Default behavior when omitted: `auto === true`.
 */
function nowIso() {
  return new Date().toISOString()
}

function clipPreview(value: string, max = 240): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}...`
}

function summarizePartPreview(part: unknown): {
  partPreview?: string
  partState?: string
  partToolCallId?: string
} {
  if (!part || typeof part !== "object") return {}
  if (isContextPartEnvelope(part)) {
    const preview =
      part.type === "message"
        ? part.content.text ?? JSON.stringify(part.content.blocks?.[0] ?? part)
        : part.type === "reasoning"
          ? part.content.text
          : part.type === "source"
            ? JSON.stringify(part.content.sources[0] ?? part)
            : part.content.status === "failed"
              ? part.content.error.message
              : JSON.stringify(part.content)
    const state =
      part.type === "reasoning"
        ? part.content.state
        : part.type === "action"
          ? part.content.status
          : undefined
    const toolCallId = part.type === "action" ? part.content.actionCallId : undefined
    return {
      partPreview: preview ? clipPreview(preview) : undefined,
      partState: state,
      partToolCallId: toolCallId,
    }
  }
  const row = part as Record<string, unknown>
  const partType = typeof row.type === "string" ? row.type : ""
  const partState = typeof row.state === "string" ? row.state : undefined
  const partToolCallId =
    typeof row.toolCallId === "string"
      ? row.toolCallId
      : typeof row.id === "string"
        ? row.id
        : undefined

  if (typeof row.text === "string" && row.text.trim().length > 0) {
    return {
      partPreview: clipPreview(row.text),
      partState,
      partToolCallId,
    }
  }

  if (partType.startsWith("tool-")) {
    const payload = {
      tool: partType,
      state: partState,
      input: row.input,
      output: row.output,
      errorText: row.errorText,
    }
    return {
      partPreview: clipPreview(JSON.stringify(payload)),
      partState,
      partToolCallId,
    }
  }

  return {
    partState,
    partToolCallId,
  }
}

async function emitContextEvents(params: {
  writable?: WritableStream<UIMessageChunk>
  events: ContextStreamEvent[]
}) {
  void params
}

async function measureBenchmark<T>(
  benchmark: ContextBenchmarkRecorder | undefined,
  name: string,
  run: () => Promise<T> | T,
): Promise<T> {
  if (!benchmark) return await run()
  return await benchmark.measure(name, run)
}

async function readActiveWorkflowExecutionContext() {
  let workflowRunId: string | null = null
  let stepId: string | null = null

  try {
    const { getWorkflowMetadata } = await import("workflow")
    const runId = getWorkflowMetadata?.()?.workflowRunId
    workflowRunId = runId ? String(runId) : null
  } catch {
    workflowRunId = null
  }

  try {
    const { getStepMetadata } = await import("workflow")
    const currentStepId = getStepMetadata?.()?.stepId
    stepId = currentStepId ? String(currentStepId) : null
  } catch {
    stepId = null
  }

  return {
    workflowRunId,
    stepId,
    inWorkflow: Boolean(workflowRunId || stepId),
  }
}

function isEmptyContextContent(content: unknown) {
  if (content == null) return true
  if (typeof content !== "object") return false
  return Object.keys(content as Record<string, unknown>).length === 0
}

function normalizeExecutionParent(
  parent: ContextExecutionParent | undefined,
): ContextExecutionParent {
  if (!parent) return null
  return {
    contextId: parent.contextId ? String(parent.contextId) : undefined,
    executionId: parent.executionId ? String(parent.executionId) : undefined,
    stepId: parent.stepId ? String(parent.stepId) : undefined,
    triggerEventId: parent.triggerEventId ? String(parent.triggerEventId) : undefined,
    reactionEventId: parent.reactionEventId ? String(parent.reactionEventId) : undefined,
  }
}

type ContextStepPatch = {
  status?: "running" | "completed" | "failed"
  errorText?: string
}

type ContextEngineOps<Context> = {
  initializeContext: (
    contextIdentifier: ContextIdentifier | null,
  ) => Promise<{ context: StoredContext<Context>; isNew: boolean }>
  updateContextContent: (
    contextIdentifier: ContextIdentifier,
    content: Context,
  ) => Promise<StoredContext<Context>>
  updateContextReactor: (
    contextIdentifier: ContextIdentifier,
    reactor: { kind: string; state?: Record<string, unknown> | null },
  ) => Promise<StoredContext<Context>>
  updateContextStatus: (
    contextIdentifier: ContextIdentifier,
    status: "open_idle" | "open_streaming" | "closed",
  ) => Promise<void>
  getItems: (contextIdentifier: ContextIdentifier) => Promise<ContextItem[]>
  openExecution: (params: {
    contextIdentifier: ContextIdentifier
    triggerEvent: ContextItem
    parent?: ContextExecutionParent
  }) => Promise<{
    triggerEvent: ContextItem
    reactionEvent: ContextItem
    execution: ContextExecution
  }>
  openExecutionStep: (params: {
    contextIdentifier: ContextIdentifier
    content: Context
    executionId: string
    iteration: number
  }) => Promise<{
    stepId: string
    stream: PersistedContextStepStreamSession
    context: StoredContext<Context>
    events: ContextItem[]
  }>
  createContextStep: (params: {
    executionId: string
    iteration: number
  }) => Promise<{ stepId: string }>
  updateContextStep: (params: {
    stepId: string
    executionId?: string
    contextId?: string
    iteration?: number
    patch: ContextStepPatch
  }) => Promise<void>
  completeExecutionStep: (params: {
    session?: PersistedContextStepStreamSession | null
    stepId: string
    executionId?: string
    contextId?: string
    iteration?: number
    parts?: any[]
    actionResults?: Array<{
      actionRequest: {
        actionRef: string
        actionName: string
        input: unknown
      }
      success: boolean
      output: unknown
      errorText?: string
    }>
    stepStatus?: ContextStepPatch["status"]
    errorText?: string
    reactionEventId?: string
    reactionEvent?: ContextItem
  }) => Promise<{
    reactionEvent?: ContextItem
    actionResultChunkEvents: ContextStreamEvent[]
  }>
  saveExecutionStepOutput: (params: {
    stepId: string
    executionId?: string
    contextId?: string
    iteration?: number
    parts: any[]
    reactionEventId: string
    reactionEvent: ContextItem
  }) => Promise<{ reactionEvent: ContextItem }>
  updateItem: (
    itemId: string,
    item: ContextItem,
    opts?: { executionId?: string; contextId?: string },
  ) => Promise<ContextItem>
  completeExecution: (
    contextIdentifier: ContextIdentifier,
    executionId: string,
    status: "completed" | "failed",
    opts?: {
      contextId?: string
      reactionEventId?: string
      reactionEvent?: ContextItem
    },
  ) => Promise<{ reactionEvent?: ContextItem }>
}

async function createRuntimeOps<Context>(
  runtimeHandle: ContextRuntime<any>,
  benchmark?: ContextBenchmarkRecorder,
): Promise<ContextEngineOps<Context> & { db: any }> {
  const runtime = await getContextRuntimeServices(runtimeHandle)
  const { db } = runtime
  const { InstantStore } = await import("./stores/instant.store.js")
  const requireContextId = (contextIdentifier: ContextIdentifier) => {
    if ("id" in contextIdentifier && typeof contextIdentifier.id === "string" && contextIdentifier.id) {
      return String(contextIdentifier.id)
    }
    throw new Error("ContextEngine direct runtime requires resolved context ids.")
  }
  const makeRuntimeId = () =>
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const instrumentAsync = async <T>(
    kind: "query" | "transact",
    run: () => Promise<T>,
  ): Promise<T> => {
    const startedAt = Date.now()
    try {
      return await run()
    } finally {
      const elapsedMs = Date.now() - startedAt
      benchmark?.add?.("react.network.totalMs", elapsedMs)
      benchmark?.add?.(`react.network.${kind}Ms`, elapsedMs)
      benchmark?.add?.(`react.network.${kind}Count`, 1)
      const currentStage = benchmark?.getCurrentStage?.()
      if (currentStage) {
        benchmark?.add?.(`${currentStage}.networkMs`, elapsedMs)
        benchmark?.add?.(`${currentStage}.${kind}Count`, 1)
      }
    }
  }
  const instrumentedDb = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return async (...args: any[]) =>
          await instrumentAsync("query", async () => await target.query(...args))
      }
      if (prop === "transact") {
        return async (...args: any[]) =>
          await instrumentAsync("transact", async () => await target.transact(...args))
      }
      return Reflect.get(target, prop, receiver)
    },
  })
  const store = new InstantStore(instrumentedDb)

  return {
    db: instrumentedDb,
    initializeContext: async (contextIdentifier) => {
      if (!contextIdentifier) {
        const context = await store.getOrCreateContext<Context>(null)
        return { context, isNew: true }
      }
      const existing = await store.getContext<Context>(contextIdentifier)
      if (existing) {
        return { context: existing, isNew: false }
      }
      const context = await store.getOrCreateContext<Context>(contextIdentifier)
      return { context, isNew: true }
    },
    updateContextContent: async (contextIdentifier, content) =>
      await store.updateContextContent(contextIdentifier, content),
    updateContextReactor: async (contextIdentifier, reactor) =>
      await store.updateContextReactor(contextIdentifier, reactor),
    updateContextStatus: async (contextIdentifier, status) =>
      await instrumentedDb.transact([
        instrumentedDb.tx.event_contexts[requireContextId(contextIdentifier)].update({
          status,
          updatedAt: new Date(),
        }),
      ]),
    openExecution: async ({ contextIdentifier, triggerEvent, parent }) => {
      const contextId = requireContextId(contextIdentifier)
      const triggerId = String(triggerEvent.id)
      const reactionId = makeRuntimeId()
      const executionId = makeRuntimeId()
      const reactionEvent: ContextItem = {
        id: reactionId,
        type: OUTPUT_ITEM_TYPE,
        channel:
          typeof triggerEvent.channel === "string"
            ? triggerEvent.channel
            : WEB_CHANNEL,
        createdAt: new Date().toISOString(),
        status: "pending",
        content: { parts: [] },
      }
      const now = new Date()
      await instrumentedDb.transact([
        instrumentedDb.tx.event_items[triggerId].update({
          ...(triggerEvent as any),
          id: triggerId,
          status: "stored",
        }),
        instrumentedDb.tx.event_items[triggerId].link({ context: contextId }),
        instrumentedDb.tx.event_items[reactionId].update({
          ...(reactionEvent as any),
          id: reactionId,
          status: "pending",
        }),
        instrumentedDb.tx.event_items[reactionId].link({ context: contextId }),
        instrumentedDb.tx.event_executions[executionId].create({
          createdAt: now,
          parentContextId: parent?.contextId ? String(parent.contextId) : undefined,
          parentExecutionId: parent?.executionId ? String(parent.executionId) : undefined,
          parentStepId: parent?.stepId ? String(parent.stepId) : undefined,
          parentTriggerEventId: parent?.triggerEventId ? String(parent.triggerEventId) : undefined,
          parentReactionEventId: parent?.reactionEventId ? String(parent.reactionEventId) : undefined,
          updatedAt: now,
          status: "executing",
        }),
        instrumentedDb.tx.event_executions[executionId].link({ context: contextId }),
        instrumentedDb.tx.event_executions[executionId].link({ trigger: triggerId }),
        instrumentedDb.tx.event_executions[executionId].link({ reaction: reactionId }),
        ...(parent?.executionId
          ? [
              instrumentedDb.tx.event_executions[executionId].link({
                parentExecution: String(parent.executionId),
              }),
            ]
          : []),
        instrumentedDb.tx.event_items[triggerId].link({ execution: executionId }),
        instrumentedDb.tx.event_items[reactionId].link({ execution: executionId }),
        instrumentedDb.tx.event_contexts[contextId].update({
          status: "open_streaming",
          updatedAt: now,
        }),
        instrumentedDb.tx.event_contexts[contextId].link({ currentExecution: executionId }),
      ])
      return {
        triggerEvent: {
          ...triggerEvent,
          id: triggerId,
          status: "stored",
        },
        reactionEvent,
        execution: {
          id: executionId,
          status: "executing",
        },
      }
    },
    openExecutionStep: async ({ contextIdentifier, content, executionId, iteration }) => {
      const stepId = makeRuntimeId()
      const now = new Date()
      await instrumentedDb.transact([
        instrumentedDb.tx.event_steps[stepId].create({
          createdAt: now,
          updatedAt: now,
          status: "running",
          iteration,
        }),
        instrumentedDb.tx.event_steps[stepId].link({ execution: executionId }),
      ])
      const stream = await createPersistedContextStepStreamForRuntime(
        { db: instrumentedDb },
        {
          executionId,
          stepId,
        },
      )
      const context = await store.updateContextContent(contextIdentifier, content)
      const events = await store.getItems(contextIdentifier)

      return {
        stepId,
        stream,
        context,
        events,
      }
    },
    createContextStep: async ({ executionId, iteration }) => {
      const stepId = makeRuntimeId()
      await instrumentedDb.transact([
        instrumentedDb.tx.event_steps[stepId].create({
          createdAt: new Date(),
          updatedAt: new Date(),
          status: "running",
          iteration,
        }),
        instrumentedDb.tx.event_steps[stepId].link({ execution: executionId }),
      ])
      return { stepId }
    },
    updateContextStep: async (params) => {
      const update: any = { updatedAt: new Date() }
      if (params.patch.status !== undefined) update.status = params.patch.status
      if (params.patch.errorText !== undefined) update.errorText = params.patch.errorText
      await instrumentedDb.transact([
        instrumentedDb.tx.event_steps[params.stepId].update(update),
      ])
    },
    completeExecutionStep: async (params) => {
      const actionResultChunkEvents = await writeActionResultPartChunksToSession({
        session: params.session,
        contextId: String(params.contextId ?? ""),
        executionId: String(params.executionId ?? ""),
        itemId: String(params.reactionEventId ?? ""),
        actionResults: params.actionResults ?? [],
      })
      if (params.parts) {
        await store.saveStepParts({ stepId: params.stepId, parts: params.parts })
      }
      if (params.session) {
        await finalizePersistedContextStepStreamForRuntime({
          runtime: { db: instrumentedDb },
          session: params.session,
          mode: "close",
        })
      }

      const update: any = { updatedAt: new Date() }
      update.status = params.stepStatus ?? "completed"
      if (params.errorText !== undefined) update.errorText = params.errorText
      await instrumentedDb.transact([
        instrumentedDb.tx.event_steps[params.stepId].update(update),
      ])

      if (!params.reactionEventId || !params.reactionEvent) {
        return { actionResultChunkEvents }
      }

      await instrumentedDb.transact([
        instrumentedDb.tx.event_items[params.reactionEventId].update(
          params.reactionEvent as any,
        ),
      ])

      return {
        reactionEvent: {
          ...(params.reactionEvent as any),
          id: params.reactionEventId,
        } as ContextItem,
        actionResultChunkEvents,
      }
    },
    saveExecutionStepOutput: async (params) => {
      await store.saveStepParts({ stepId: params.stepId, parts: params.parts })
      await instrumentedDb.transact([
        instrumentedDb.tx.event_items[params.reactionEventId].update(
          params.reactionEvent as any,
        ),
      ])
      return {
        reactionEvent: {
          ...(params.reactionEvent as any),
          id: params.reactionEventId,
        } as ContextItem,
      }
    },
    getItems: async (contextIdentifier) => await store.getItems(contextIdentifier),
    updateItem: async (itemId, item) => {
      await instrumentedDb.transact([instrumentedDb.tx.event_items[itemId].update(item as any)])
      return {
        ...(item as any),
        id: itemId,
      } as ContextItem
    },
    completeExecution: async (contextIdentifier, executionId, status, opts) => {
      const contextId = requireContextId(contextIdentifier)
      const txs = [
        instrumentedDb.tx.event_executions[executionId].update({
          status,
          updatedAt: new Date(),
        }),
        instrumentedDb.tx.event_contexts[contextId].update({
          status: "closed",
          updatedAt: new Date(),
        }),
      ]
      if (opts?.reactionEventId && opts.reactionEvent) {
        txs.push(
          instrumentedDb.tx.event_items[opts.reactionEventId].update(
            opts.reactionEvent as any,
          ),
        )
      }
      await instrumentedDb.transact(txs)
      return opts?.reactionEventId && opts.reactionEvent
        ? {
            reactionEvent: {
              ...(opts.reactionEvent as any),
              id: opts.reactionEventId,
            } as ContextItem,
          }
        : {}
    },
  }
}

async function createWorkflowOps<Context>(
  runtime: ContextRuntime<any>,
): Promise<ContextEngineOps<Context>> {
  const env = runtime.env
  return {
    initializeContext: async (contextIdentifier) =>
      await initializeContext<Context>({ runtime, contextIdentifier }),
    updateContextContent: async (contextIdentifier, content) =>
      await updateContextContent<Context>({ runtime, contextIdentifier, content }),
    updateContextReactor: async (contextIdentifier, reactor) =>
      await updateContextReactor<Context>({ runtime, contextIdentifier, reactor }),
    updateContextStatus: async (contextIdentifier, status) =>
      await updateContextStatus({ runtime, contextIdentifier, status }),
    openExecution: async ({ contextIdentifier, triggerEvent, parent }) =>
      await openExecution({ runtime, contextIdentifier, triggerEvent, parent }),
    openExecutionStep: async (params) =>
      await openExecutionStep<Context>({ runtime, ...params }),
    createContextStep: async ({ executionId, iteration }) =>
      await createContextStep({ runtime, executionId, iteration }),
    updateContextStep: async (params) =>
      await updateContextStep({ runtime, ...params }),
    completeExecutionStep: async (params) =>
      await completeExecutionStep({ runtime, ...params }),
    saveExecutionStepOutput: async (params) =>
      await saveExecutionStepOutput({ runtime, ...params }),
    getItems: async (contextIdentifier) =>
      await getContextItems({ runtime, contextIdentifier }),
    updateItem: async (itemId, item, opts) =>
      await updateItem({ runtime, eventId: itemId, event: item, opts }),
    completeExecution: async (contextIdentifier, executionId, status, opts) =>
      await completeExecution({ runtime, contextIdentifier, executionId, status, ...opts }),
  }
}

async function getContextEngineOps<Context>(
  runtime: ContextRuntime<any>,
  benchmark?: ContextBenchmarkRecorder,
) {
  const executionContext = await readActiveWorkflowExecutionContext()
  if (executionContext.inWorkflow) {
    return await createWorkflowOps<Context>(runtime)
  }

  return await createRuntimeOps<Context>(runtime, benchmark)
}

export abstract class ContextEngine<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> {
  private readonly reactor: ContextReactor<Context, Env, RequiredDomain>

  constructor(
    protected readonly opts: ContextOptions<Context, Env, RequiredDomain> = {},
    reactor?: ContextReactor<Context, Env, RequiredDomain>,
  ) {
    this.reactor =
      reactor ??
      (createAiSdkReactor<Context, Env>() as unknown as ContextReactor<Context, Env, RequiredDomain>)
  }

  protected abstract initialize(
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): Promise<Context> | Context

  protected abstract buildSystemPrompt(
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): Promise<string> | string

  protected abstract buildTools(
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): Promise<Record<string, ContextTool<Context, Env, RequiredDomain>>> | Record<string, ContextTool<Context, Env, RequiredDomain>>

  protected async buildSkills(
    _context: StoredContext<Context>,
    _env: Env,
    _runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): Promise<ContextSkillPackage[]> {
    return []
  }

  /**
   * First-class event expansion stage (runs before each explicit prompt).
   *
   * Use this to expand/normalize events before they are converted into model messages.
   * Typical use-cases:
   * - Expand file/document references into text (LlamaCloud/Reducto/…)
   * - Token compaction / summarization of older parts
   * - Attaching derived context snippets to the next model call
   *
   * IMPORTANT:
   * - This stage is ALWAYS executed by the engine.
   * - If you don't provide an implementation, the default behavior is an identity transform
   *   (events pass through unchanged).
   * - If your implementation performs I/O, implement it as a `"use-step"` function so results
   *   are workflow-safe when react runs inside a workflow.
   * - If it’s pure/deterministic, it can run in workflow context.
   */
  protected async expandEvents(
    events: ContextItem[],
    _context: StoredContext<Context>,
    _env: Env,
    _runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): Promise<ContextItem[]> {
    return events
  }

  protected getModel(
    _context: StoredContext<Context>,
    _env: Env,
    _runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): ContextModelInit {
    return "openai/gpt-5"
  }

  protected getReactor(
    _context: StoredContext<Context>,
    _env: Env,
    _runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ): ContextReactor<Context, Env, RequiredDomain> {
    return this.reactor
  }

  public async react<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
    handler: ContextExecutionHandler<Context, Env, RequiredDomain>,
  ): Promise<ContextReactResult<Context, ContextDirectRun<Context>>>
  public async react<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
    handler: ContextExecutionHandler<Context, Env, RequiredDomain>,
  ): Promise<ContextReactResult<Context, ContextDirectRun<Context>>> {
    if (!handler) {
      throw new Error("ContextEngine.react requires an explicit execution handler.")
    }
    return await ContextEngine.runExplicit(this, triggerEvent, params, handler)
  }

  private static async prepareExecutionShell<
    Context,
    Env extends ContextEnvironment,
    RequiredDomain extends DomainSchemaResult,
    Runtime extends ContextRuntime<Env>,
  >(
    story: ContextEngine<Context, Env, RequiredDomain>,
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
  ) {
    const runtimeHandle = await resolveReactRuntime(params)
    const env = (runtimeHandle as Runtime).env
    const ops = await measureBenchmark(
      params.__benchmark,
      "react.resolveOpsMs",
      async () => await getContextEngineOps<Context>(runtimeHandle as Runtime, params.__benchmark),
    )

    const ctxResult = await measureBenchmark(
      params.__benchmark,
      "react.initializeContextMs",
      async () => await ops.initializeContext(params.context ?? null),
    )
    let currentContext = ctxResult.context

    const contextSelector: ContextIdentifier = { id: String(currentContext.id) }

    if (ctxResult.isNew) {
      await story.opts.onContextCreated?.({
        env,
        runtime: runtimeHandle,
        context: currentContext,
      })
    }

    if (currentContext.status === "closed") {
      await measureBenchmark(
        params.__benchmark,
        "react.reopenClosedContextMs",
        async () => await ops.updateContextStatus(contextSelector, "open_idle"),
      )
      currentContext = { ...currentContext, status: "open_idle" }
    }

    const shell = await measureBenchmark(
      params.__benchmark,
      "react.openExecutionMs",
      async () =>
        await ops.openExecution({
          contextIdentifier: contextSelector,
          triggerEvent,
          parent: normalizeExecutionParent(params.parent),
        }),
    )
    currentContext = { ...currentContext, status: "open_streaming" }

    return {
      runtimeHandle,
      contextSelector,
      currentContext,
      trigger: shell.triggerEvent,
      reaction: shell.reactionEvent,
      execution: shell.execution,
    }
  }

  private static async runExplicit<
    Context,
    Env extends ContextEnvironment,
    RequiredDomain extends DomainSchemaResult,
    Runtime extends ContextRuntime<Env>,
  >(
    story: ContextEngine<Context, Env, RequiredDomain>,
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
    handler: ContextExecutionHandler<Context, Env, RequiredDomain>,
  ): Promise<ContextReactResult<Context, ContextDirectRun<Context>>> {
    if (!params.__bootstrap) {
      const shell = await ContextEngine.prepareExecutionShell(story, triggerEvent, params)
      const run: ContextDirectRun<Context> = ContextEngine.runExplicit(
        story,
        triggerEvent,
        {
          ...params,
          runtime: shell.runtimeHandle,
          __bootstrap: {
            contextId: shell.currentContext.id,
            trigger: shell.trigger,
            reaction: shell.reaction,
            execution: shell.execution,
          },
        },
        handler,
      )

      return {
        context: shell.currentContext,
        trigger: shell.trigger,
        reaction: shell.reaction,
        execution: shell.execution,
        run,
      }
    }

    const runtimeHandle = await resolveReactRuntime(params)
    const env = (runtimeHandle as Runtime).env
    const ops = await measureBenchmark(
      params.__benchmark,
      "react.explicit.resolveOpsMs",
      async () =>
        await getContextEngineOps<Context>(runtimeHandle as Runtime, params.__benchmark),
    )

    const preventClose = params.options?.preventClose ?? false
    const sendFinish = params.options?.sendFinish ?? true
    const writable = params.options?.writable

    const bootstrapped = params.__bootstrap
    const activeContextSelector = {
      id: String(bootstrapped.contextId),
    } as ContextIdentifier
    let currentContext = (await measureBenchmark(
      params.__benchmark,
      "react.explicit.bootstrapContextLookupMs",
      async () =>
        await ops.initializeContext(activeContextSelector),
    )).context
    let trigger = bootstrapped.trigger
    let reactionEvent: ContextItem = bootstrapped.reaction
    let execution: ContextExecution = bootstrapped.execution

    const triggerEventId = trigger.id
    const reactionEventId = reactionEvent.id
    const executionId = execution.id

    let updatedContext: StoredContext<Context> = {
      ...currentContext,
      status: "open_streaming",
    }
    const initializedContent = await measureBenchmark(
      params.__benchmark,
      "react.explicit.contextMs",
      async () => await story.initialize(updatedContext, env, runtimeHandle),
    )
    updatedContext = await measureBenchmark(
      params.__benchmark,
      "react.explicit.updateContextContentMs",
      async () => await ops.updateContextContent(activeContextSelector, initializedContent),
    )
    currentContext = updatedContext
    await story.opts.onContextUpdated?.({
      env,
      runtime: runtimeHandle,
      context: updatedContext,
    })
    let iteration = 0
    let ended = false
    let currentStepId: string | null = null
    let currentStepStream: PersistedContextStepStreamSession | null = null

    const failExecution = async () => {
      try {
        if (currentStepId) {
          await ops.updateContextStep({
            stepId: currentStepId,
            executionId,
            contextId: String(currentContext.id),
            iteration: Math.max(0, iteration - 1),
            patch: { status: "failed" },
          })
        }
      } catch {
        // noop
      }
      try {
        if (currentStepStream) {
          await abortPersistedContextStepStream({
            runtime: runtimeHandle as any,
            session: currentStepStream,
          })
          currentStepStream = null
        }
      } catch {
        // noop
      }
      try {
        await ops.completeExecution(activeContextSelector, executionId, "failed")
        execution = { ...execution, status: "failed" }
        updatedContext = { ...updatedContext, status: "closed" }
      } catch {
        // noop
      }
      try {
        await closeContextStream({ preventClose, sendFinish, writable })
      } catch {
        // noop
      }
    }

    const appendPromptMetadata = (parts: any[], name: string) =>
      parts.map((part) => {
        if (!part || typeof part !== "object") return part
        return {
          ...part,
          reactorMetadata: {
            reactorKind: "explicit",
            ...((part as any).reactorMetadata ?? {}),
            eventName: name,
            executionId,
            itemId: reactionEventId,
          },
        }
      })

    const executeActionRequests = async (
      actionRequests: any[],
      actions: Record<string, ContextTool<Context, Env, RequiredDomain>>,
      messagesForModel: ModelMessage[],
      stepId: string,
      stepIteration: number,
    ): Promise<ContextExecutionActionResult[]> =>
      await Promise.all(
        actionRequests.map(async (actionRequest: any) => {
          const actionDef = (actions as any)[actionRequest.actionName] as any
          if (!actionDef || typeof actionDef.execute !== "function") {
            return {
              actionRequest,
              success: false,
              output: null,
              errorText: `Action "${actionRequest.actionName}" not found or has no execute().`,
            }
          }

          try {
            let actionInput = actionRequest.input
            if ((actionDef as any)?.auto === false) {
              const { createHook, createWebhook } = await import("workflow")
              const actionCallId = String(actionRequest.actionRef)
              const hookToken = toolApprovalHookToken({
                executionId,
                toolCallId: actionCallId,
              })
              const hook = createHook<ContextToolApprovalPayload>({ token: hookToken })
              const webhook = createWebhook()

              const approvalOrRequest = await Promise.race([
                hook.then((approval) => ({ source: "hook" as const, approval })),
                webhook.then((request) => ({ source: "webhook" as const, request })),
              ])

              const approval: ContextToolApprovalPayload | null =
                approvalOrRequest.source === "hook"
                  ? approvalOrRequest.approval
                  : await (approvalOrRequest.request as any).json().catch(() => null)

              if (!approval || approval.approved !== true) {
                return {
                  actionRequest,
                  success: false,
                  output: null,
                  errorText:
                    approval && "comment" in approval && approval.comment
                      ? `Action execution not approved: ${approval.comment}`
                      : "Action execution not approved",
                }
              }

              if ("args" in approval && approval.args !== undefined) {
                actionInput = approval.args
              }
            }

            const output = await Reflect.apply(actionDef.execute, undefined, [
              actionInput,
              {
                runtime: runtimeHandle,
                context: updatedContext,
                contextIdentifier: activeContextSelector,
                toolCallId: actionRequest.actionRef,
                messages: messagesForModel,
                eventId: reactionEventId,
                executionId,
                triggerEventId,
                contextId: currentContext.id,
                stepId,
                iteration: stepIteration,
                contextStepStream: currentStepStream?.stream,
              },
            ])
            return { actionRequest, success: true, output }
          } catch (error: any) {
            return {
              actionRequest,
              success: false,
              output: null,
              errorText: error instanceof Error ? error.message : String(error),
            }
          }
        }),
      )

    const completePromptStep = async (params: {
      session: PersistedContextStepStreamSession | null
      stepId: string
      stepIteration: number
      stepParts: any[]
      reactionParts: any[]
      actionResults: ContextExecutionActionResult[]
      status?: "completed" | "failed"
      errorText?: string
    }) => {
      const nextReactionEvent: ContextItem = {
        ...reactionEvent,
        content: {
          ...reactionEvent.content,
          parts: params.reactionParts,
        },
        status: "pending",
      }
      const completed = await ops.completeExecutionStep({
        session: params.session,
        stepId: params.stepId,
        parts: params.stepParts,
        actionResults: params.actionResults as any,
        stepStatus: params.status ?? "completed",
        errorText: params.errorText,
        reactionEventId,
        reactionEvent: nextReactionEvent,
        executionId,
        contextId: String(currentContext.id),
        iteration: params.stepIteration,
      })
      reactionEvent = completed.reactionEvent ?? nextReactionEvent
      await emitContextEvents({
        writable,
        events: completed.actionResultChunkEvents,
      })
      currentStepStream = null
      currentStepId = null
    }

    const handle: ContextExecutionHandle<Context, Env, RequiredDomain> = {
      get contextId() {
        return String(currentContext.id)
      },
      get executionId() {
        return executionId
      },
      get triggerEventId() {
        return String(triggerEventId)
      },
      get reactionEventId() {
        return String(reactionEventId)
      },
      get state() {
        return updatedContext
      },
      async context(content: Context) {
        updatedContext = await measureBenchmark(
          params.__benchmark,
          "react.explicit.contextMs",
          async () => await ops.updateContextContent(activeContextSelector, content),
        )
        await story.opts.onContextUpdated?.({
          env,
          runtime: runtimeHandle,
          context: updatedContext,
        })
        return updatedContext
      },
      async prompt(name, promptOptions = {}) {
        const stepIteration = iteration++
        const openedStep = await measureBenchmark(
          params.__benchmark,
          `react.explicit.step.${stepIteration}.openExecutionStepMs`,
          async () =>
            await ops.openExecutionStep({
              contextIdentifier: activeContextSelector,
              content: (updatedContext.content ?? ({} as Context)) as Context,
              executionId,
              iteration: stepIteration,
            }),
        )
        currentStepId = openedStep.stepId
        currentStepStream = openedStep.stream
        updatedContext = openedStep.context

        const rawEvents = openedStep.events
        const expandedEvents = await measureBenchmark(
          params.__benchmark,
          `react.explicit.step.${stepIteration}.expandEventsMs`,
          async () =>
            await story.expandEvents(rawEvents, updatedContext, env, runtimeHandle),
        )
        const actions = promptOptions.actions ?? {}
        const skills = promptOptions.skills ?? []
        const systemPrompt = promptOptions.instructions ?? name
        const reactor =
          promptOptions.reactor ?? story.getReactor(updatedContext, env, runtimeHandle)
        const model = story.getModel(updatedContext, env, runtimeHandle)
        const reactionPartsBeforeStep = Array.isArray(reactionEvent.content?.parts)
          ? [...reactionEvent.content.parts]
          : []
        let persistedReactionPartsSignature = ""
        const persistReactionParts = async (nextParts: any[]) => {
          const normalizedParts = appendPromptMetadata(
            normalizePartsForPersistence(Array.isArray(nextParts) ? nextParts : []),
            name,
          )
          const nextSignature = JSON.stringify(normalizedParts)
          if (nextSignature === persistedReactionPartsSignature) return
          persistedReactionPartsSignature = nextSignature

          const saved = await ops.saveExecutionStepOutput({
            stepId: openedStep.stepId,
            parts: normalizedParts,
            reactionEventId,
            reactionEvent: {
              ...reactionEvent,
              content: {
                ...reactionEvent.content,
                parts: [...reactionPartsBeforeStep, ...normalizedParts],
              },
              status: "pending",
            },
            executionId,
            contextId: String(currentContext.id),
            iteration: stepIteration,
          })
          reactionEvent = saved.reactionEvent
        }

        try {
          const reactionResult = await measureBenchmark(
            params.__benchmark,
            `react.explicit.step.${stepIteration}.reactorMs`,
            async () =>
              await reactor({
                runtime: runtimeHandle,
                context: updatedContext,
                contextIdentifier: activeContextSelector,
                events: expandedEvents,
                triggerEvent,
                model,
                systemPrompt,
                actions,
                skills,
                eventId: reactionEventId,
                executionId,
                contextId: String(currentContext.id),
                stepId: String(openedStep.stepId),
                iteration: stepIteration,
                maxModelSteps:
                  promptOptions.maxModelSteps ??
                  1,
                sendStart: stepIteration === 0,
                contextStepStream: currentStepStream?.stream,
                writable,
                persistReactionParts,
              }),
          )

          const stepParts = appendPromptMetadata(
            normalizePartsForPersistence(
              ((((reactionResult.assistantEvent as any)?.content?.parts ?? []) as any[]) as any[]),
            ),
            name,
          )
          const nextAssistantParts = Array.isArray(stepParts) ? stepParts : []
          let finalizedStepParts = [...nextAssistantParts]
          const actionResults = reactionResult.actionRequests.length
            ? await measureBenchmark(
                params.__benchmark,
                `react.explicit.step.${stepIteration}.actionExecutionMs`,
                async () =>
                  await executeActionRequests(
                    reactionResult.actionRequests as any[],
                    actions,
                    reactionResult.messagesForModel,
                    openedStep.stepId,
                    stepIteration,
                  ),
              )
            : []

          for (const result of actionResults) {
            finalizedStepParts = applyToolExecutionResultToParts(
              finalizedStepParts,
              {
                toolCallId: result.actionRequest.actionRef,
                toolName: result.actionRequest.actionName,
              },
              {
                success: Boolean(result.success),
                result: result.output,
                message: result.errorText,
              },
            )
          }
          finalizedStepParts = appendPromptMetadata(
            normalizePartsForPersistence(finalizedStepParts),
            name,
          )

          await completePromptStep({
            session: currentStepStream,
            stepId: openedStep.stepId,
            stepIteration,
            stepParts: finalizedStepParts,
            reactionParts: [...reactionPartsBeforeStep, ...finalizedStepParts],
            actionResults,
          })

          for (const result of actionResults) {
            await story.opts.onActionExecuted?.({
              actionRequest: result.actionRequest,
              success: result.success,
              output: result.output,
              errorText: result.errorText,
              eventId: reactionEventId,
              executionId,
            })
          }

          return {
            stepId: openedStep.stepId,
            parts: finalizedStepParts,
            actionRequests: reactionResult.actionRequests,
            actionResults,
            reaction: reactionEvent,
          }
        } catch (error: any) {
          await completePromptStep({
            session: currentStepStream,
            stepId: openedStep.stepId,
            stepIteration,
            stepParts: [],
            reactionParts: Array.isArray(reactionEvent.content?.parts)
              ? [...reactionEvent.content.parts]
              : [],
            actionResults: [],
            status: "failed",
            errorText: error instanceof Error ? error.message : String(error),
          }).catch(() => null)
          throw error
        }
      },
      async end(input?: ContextExecutionEndInput) {
        if (ended) {
          return {
            context: updatedContext,
            trigger,
            reaction: reactionEvent,
            execution,
          }
        }

        const normalizedInput =
          typeof input === "string" ? { message: input } : input ?? {}
        const outputParts = Array.isArray((normalizedInput as any).parts)
          ? normalizePartsForPersistence((normalizedInput as any).parts)
          : []
        const message =
          typeof (normalizedInput as any).message === "string"
            ? String((normalizedInput as any).message)
            : ""
        const messageParts = message
          ? [
              {
                type: "message",
                content: { text: message },
                reactorMetadata: {
                  reactorKind: "explicit",
                  eventName: "end",
                  executionId,
                  itemId: reactionEventId,
                },
              },
            ]
          : []
        const existingParts = Array.isArray(reactionEvent.content?.parts)
          ? [...reactionEvent.content.parts]
          : []
        const completedReactionEvent: ContextItem = {
          ...reactionEvent,
          content: {
            ...reactionEvent.content,
            parts: [...existingParts, ...messageParts, ...outputParts],
          },
          status: "completed",
        }
        const status = (normalizedInput as any).status === "failed" ? "failed" : "completed"
        const completed = await ops.completeExecution(
          activeContextSelector,
          executionId,
          status,
          {
            contextId: String(currentContext.id),
            reactionEventId,
            reactionEvent: completedReactionEvent,
          },
        )
        reactionEvent = completed.reactionEvent ?? completedReactionEvent
        execution = { ...execution, status }
        updatedContext = { ...updatedContext, status: "closed" }
        ended = true
        await closeContextStream({ preventClose, sendFinish, writable })
        return {
          context: updatedContext,
          trigger,
          reaction: reactionEvent,
          execution,
        }
      },
    }

    try {
      const handlerResult = await handler(handle)
      if (!ended) {
        return await handle.end(
          handlerResult === undefined || handlerResult === null
            ? undefined
            : (handlerResult as any),
        )
      }
      return {
        context: updatedContext,
        trigger,
        reaction: reactionEvent,
        execution,
      }
    } catch (error) {
      await failExecution()
      throw error
    }
  }

  private async callOnEnd(lastEvent: ContextItem): Promise<boolean> {
    if (!this.opts.onEnd) return true
    const result = await this.opts.onEnd(lastEvent)
    if (typeof result === "boolean") return result
    return true
  }
}




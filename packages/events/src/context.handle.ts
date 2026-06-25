import { randomUUID } from "node:crypto"

import {
  prepareContextLocal,
  prepareExecutionLocal,
  prepareStepPartLocal,
  type ContextLocalFileReader,
  type ContextLocalRepositoryMaterializer,
  type PreparedContextLocal,
  type PreparedExecutionLocal,
  type PreparedStepPartLocal,
} from "./context.local.js"
import {
  prepareContextSandbox,
  prepareExecutionSandbox,
  prepareStepPartSandbox,
  type ContextSandboxRepositoryMaterializer,
  type ContextSandboxSession,
} from "./context.sandbox.js"
import type {
  ContextExecution,
  ContextIdentifier,
  ContextItem,
  ContextResource,
  ContextStep,
  StoredContext,
  StoredContextResource,
} from "./context.store.js"
import type { Channel } from "./context.contract.js"
import { getContextRuntimeServices, type ContextRuntimeServiceHandle } from "./context.runtime.js"

export type ContextHandleCreateParams<Context = unknown> = {
  id?: string
  key?: string
  content?: Context | null
  description?: string | null
  goal?: string | null
  resources?: ContextResource[]
  reactor?: { kind: string; state?: Record<string, unknown> | null } | null
}

export type ContextHandleEventParams = {
  id?: string
  type?: "input" | "output"
  channel?: Channel
  createdAt?: string | Date
  status?: ContextItem["status"]
  content?: ContextItem["content"]
  parts?: unknown[]
}

export type ContextHandleOpenExecutionParams = {
  triggerEvent: ContextItem
  reactionEvent?: ContextItem
}

export type ContextHandlePrepareLocalOptions = {
  basePath: string
  readFile?: ContextLocalFileReader
  materializeRepository?: ContextLocalRepositoryMaterializer
}

export type ContextHandlePrepareExecutionLocalOptions = ContextHandlePrepareLocalOptions & {
  executionId: string
  triggerEventId?: string
  reactionEventId?: string
}

export type ContextHandlePreparePartLocalOptions = {
  basePath: string
  executionId: string
  stepId: string
  partId: string
  metadata?: Record<string, unknown> | null
}

export type ContextHandlePrepareSandboxOptions = {
  sandbox: ContextSandboxSession
  readFile?: ContextLocalFileReader
  materializeRepository?: ContextSandboxRepositoryMaterializer
}

export type ContextHandlePrepareExecutionSandboxOptions =
  ContextHandlePrepareSandboxOptions & {
    executionId: string
    triggerEventId?: string
    reactionEventId?: string
  }

export type ContextHandlePreparePartSandboxOptions = {
  sandbox: ContextSandboxSession
  executionId: string
  stepId: string
  partId: string
  metadata?: Record<string, unknown> | null
}

export type ContextHandleOpenExecutionResult = {
  context: StoredContext<unknown>
  trigger: ContextItem
  reaction: ContextItem
  execution: ContextExecution
}

function contextIdentifierFromParams(params: ContextHandleCreateParams): ContextIdentifier {
  if (typeof params.id === "string" && params.id.trim()) {
    return { id: params.id }
  }
  if (typeof params.key === "string" && params.key.trim()) {
    return { key: params.key }
  }
  return { key: `context:${randomUUID()}` }
}

function normalizeDate(value: string | Date | undefined) {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string" && value.trim()) return value
  return new Date().toISOString()
}

function createItem(params: ContextHandleEventParams): ContextItem {
  return {
    id: params.id ?? randomUUID(),
    type: params.type ?? "input",
    channel: params.channel ?? "web",
    createdAt: normalizeDate(params.createdAt),
    status: params.status,
    content: params.content ?? {
      parts: params.parts ?? [],
    },
  }
}

export class ContextHandle<Context = unknown> {
  readonly runtime: ContextRuntimeServiceHandle
  readonly context: StoredContext<Context>

  constructor(runtime: ContextRuntimeServiceHandle, context: StoredContext<Context>) {
    this.runtime = runtime
    this.context = context
  }

  get id() {
    return this.context.id
  }

  get key() {
    return this.context.key
  }

  identifier(): ContextIdentifier {
    return { id: this.context.id }
  }

  async refresh(): Promise<ContextHandle<Context>> {
    const { store } = await getContextRuntimeServices(this.runtime)
    const context = await store.getContext<Context>({ id: this.context.id })
    if (!context) {
      throw new Error(`ContextHandle: context ${this.context.id} was not found.`)
    }
    return new ContextHandle(this.runtime, context)
  }

  async updateContent(content: Context): Promise<ContextHandle<Context>> {
    const { store } = await getContextRuntimeServices(this.runtime)
    const context = await store.updateContextContent<Context>(this.identifier(), content)
    return new ContextHandle(this.runtime, context)
  }

  async updateDefinition(definition: {
    description?: string | null
    goal?: string | null
  }): Promise<ContextHandle<Context>> {
    const { store } = await getContextRuntimeServices(this.runtime)
    const context = await store.updateContextDefinition<Context>(this.identifier(), definition)
    return new ContextHandle(this.runtime, context)
  }

  async upsertResources(resources: ContextResource[]): Promise<StoredContextResource[]> {
    const { store } = await getContextRuntimeServices(this.runtime)
    return await store.upsertContextResources(this.identifier(), resources)
  }

  async resources(): Promise<StoredContextResource[]> {
    const { store } = await getContextRuntimeServices(this.runtime)
    return await store.getContextResources(this.identifier())
  }

  async event(params: ContextHandleEventParams): Promise<ContextItem> {
    const { store } = await getContextRuntimeServices(this.runtime)
    return await store.saveItem(this.identifier(), createItem(params))
  }

  async input(params: Omit<ContextHandleEventParams, "type">): Promise<ContextItem> {
    return await this.event({ ...params, type: "input" })
  }

  async output(params: Omit<ContextHandleEventParams, "type">): Promise<ContextItem> {
    return await this.event({ ...params, type: "output" })
  }

  async openExecution(
    params: ContextHandleOpenExecutionParams,
  ): Promise<ContextHandleOpenExecutionResult> {
    const { store } = await getContextRuntimeServices(this.runtime)
    const trigger = await store.saveItem(this.identifier(), params.triggerEvent)
    const reaction =
      params.reactionEvent ??
      createItem({
        type: "output",
        channel: trigger.channel,
        status: "pending",
        content: { parts: [] },
      })

    const storedReaction = await store.saveItem(this.identifier(), reaction)
    const pendingReaction =
      storedReaction.status === "pending"
        ? storedReaction
        : await store.updateItem(storedReaction.id, {
          ...storedReaction,
          status: "pending",
        })

    const execution = await store.createExecution(
      this.identifier(),
      trigger.id,
      pendingReaction.id,
    )

    const refreshed = await this.refresh()
    return {
      context: refreshed.context,
      trigger,
      reaction: pendingReaction,
      execution: {
        id: execution.id,
        status: "executing",
      },
    }
  }

  async createStep(params: { executionId: string; iteration: number }): Promise<ContextStep> {
    const { store } = await getContextRuntimeServices(this.runtime)
    const step = await store.createStep(params)
    return {
      id: step.id,
      createdAt: new Date(),
      status: "running",
      iteration: params.iteration,
    }
  }

  async saveStepParts(params: { stepId: string; parts: unknown[] }): Promise<void> {
    const { store } = await getContextRuntimeServices(this.runtime)
    await store.saveStepParts({ stepId: params.stepId, parts: params.parts })
  }

  async prepareLocal(options: ContextHandlePrepareLocalOptions): Promise<PreparedContextLocal> {
    const refreshed = await this.refresh()
    return await prepareContextLocal({
      basePath: options.basePath,
      context: refreshed.context,
      readFile: options.readFile,
      materializeRepository: options.materializeRepository,
    })
  }

  async prepareExecutionLocal(
    options: ContextHandlePrepareExecutionLocalOptions,
  ): Promise<PreparedExecutionLocal> {
    const refreshed = await this.refresh()
    return await prepareExecutionLocal({
      basePath: options.basePath,
      context: refreshed.context,
      executionId: options.executionId,
      triggerEventId: options.triggerEventId,
      reactionEventId: options.reactionEventId,
      readFile: options.readFile,
      materializeRepository: options.materializeRepository,
    })
  }

  async preparePartLocal(
    options: ContextHandlePreparePartLocalOptions,
  ): Promise<PreparedStepPartLocal> {
    return await prepareStepPartLocal({
      basePath: options.basePath,
      contextId: this.context.id,
      executionId: options.executionId,
      stepId: options.stepId,
      partId: options.partId,
      metadata: options.metadata,
    })
  }

  async prepareSandbox(options: ContextHandlePrepareSandboxOptions): Promise<PreparedContextLocal> {
    const refreshed = await this.refresh()
    return await prepareContextSandbox({
      sandbox: options.sandbox,
      context: refreshed.context,
      readFile: options.readFile,
      materializeRepository: options.materializeRepository,
    })
  }

  async prepareExecutionSandbox(
    options: ContextHandlePrepareExecutionSandboxOptions,
  ): Promise<PreparedExecutionLocal> {
    const refreshed = await this.refresh()
    return await prepareExecutionSandbox({
      sandbox: options.sandbox,
      context: refreshed.context,
      executionId: options.executionId,
      triggerEventId: options.triggerEventId,
      reactionEventId: options.reactionEventId,
      readFile: options.readFile,
      materializeRepository: options.materializeRepository,
    })
  }

  async preparePartSandbox(
    options: ContextHandlePreparePartSandboxOptions,
  ): Promise<PreparedStepPartLocal> {
    return await prepareStepPartSandbox({
      sandbox: options.sandbox,
      contextId: this.context.id,
      executionId: options.executionId,
      stepId: options.stepId,
      partId: options.partId,
      metadata: options.metadata,
    })
  }

  static async get<Context = unknown>(
    runtime: ContextRuntimeServiceHandle,
    identifier: ContextIdentifier,
  ): Promise<ContextHandle<Context> | null> {
    const { store } = await getContextRuntimeServices(runtime)
    const context = await store.getContext<Context>(identifier)
    return context ? new ContextHandle(runtime, context) : null
  }

  static async create<Context = unknown>(
    runtime: ContextRuntimeServiceHandle,
    params: ContextHandleCreateParams<Context>,
  ): Promise<ContextHandle<Context>> {
    const { store } = await getContextRuntimeServices(runtime)
    const identifier = contextIdentifierFromParams(params)
    let context = await store.getOrCreateContext<Context>(identifier)

    if (params.content !== undefined) {
      context = await store.updateContextContent<Context>(
        { id: context.id },
        params.content as Context,
      )
    }

    if (params.description !== undefined || params.goal !== undefined) {
      context = await store.updateContextDefinition<Context>({ id: context.id }, {
        description: params.description,
        goal: params.goal,
      })
    }

    if (Array.isArray(params.resources)) {
      await store.upsertContextResources({ id: context.id }, params.resources)
      context = await store.getOrCreateContext<Context>({ id: context.id })
    }

    if (params.reactor) {
      context = await store.updateContextReactor<Context>({ id: context.id }, params.reactor)
    }

    return new ContextHandle(runtime, context)
  }
}

export async function createContextHandle<Context = unknown>(
  runtime: ContextRuntimeServiceHandle,
  params: ContextHandleCreateParams<Context>,
): Promise<ContextHandle<Context>> {
  return await ContextHandle.create(runtime, params)
}

export async function getContextHandle<Context = unknown>(
  runtime: ContextRuntimeServiceHandle,
  identifier: ContextIdentifier,
): Promise<ContextHandle<Context> | null> {
  return await ContextHandle.get(runtime, identifier)
}

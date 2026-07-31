import {
  getDomainActions,
  type DomainActionBelongsTo,
  type DomainActionInput,
  type DomainActionOutput,
  type DomainActionRegistration,
  type DomainActionsOf,
  type DomainEventDraft,
  type DomainEventMethods,
  type DomainEventsOf,
  type DomainLike,
} from "@ekairos/domain"
import { getDomainActionBinding } from "@ekairos/domain/internal"
import {
  ContextHandle,
  getContextRuntimeServices,
  uuidV5,
  type ContextEvent,
  type ContextRuntimeServiceHandle,
  type StoredContext,
} from "@ekairos/events"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { z } from "zod"

import {
  describeAgentDatasetDomain,
  describeAvailableAgentDatasets,
} from "./agent-dataset-runtime.js"
import {
  deriveDatasetSource,
  toReactionOperationActionRef,
  type ReactionGitInput,
  type ReactionOperation,
  type ReactionOperationRequest,
  type ReactionOperationResult,
} from "./reaction.operation.contract.js"
import {
  action as actionStep,
  agent as agentStep,
  dataset as datasetStep,
  git as gitStep,
  loadFiles as loadFilesStep,
  shell as shellStep,
  storeFiles as storeFilesStep,
} from "./reaction.steps.js"
import type {
  AnyReactionEngine,
  ReactionModel,
  ReactionSandbox,
  ReactorGitCloneOutput,
  ReactorGitCommitOutput,
  ReactorGitPushOutput,
  ReactorInitialContext,
  ReactorLoadFilesOutput,
  ReactorShellRunInput,
  ReactorShellRunOutput,
  ReactorStoreFilesInput,
  ReactorStoreFilesOutput,
} from "./reactor.js"
type AnyDomainAction = DomainActionRegistration<any, any, any, any>
type AnyDomainEventDraft = DomainEventDraft<any, any, any, any, any, any>

type ScopedDomainEventDraft<TScope extends DomainLike> = {
  [Key in keyof DomainEventsOf<TScope> & string]:
    ReturnType<DomainEventMethods<DomainEventsOf<TScope>>[Key]>
}[keyof DomainEventsOf<TScope> & string]

export type SessionPoint<TScope extends DomainLike> =
  | ContextEvent
  | ScopedDomainEventDraft<TScope>

type EventSource<TScope extends DomainLike> =
  | SessionPoint<TScope>
  | readonly SessionPoint<TScope>[]

type ActionAllowedInScope<TAction, TScope> =
  TAction extends DomainActionRegistration<any, any, any, any, infer Key>
    ? DomainActionBelongsTo<TAction, TScope> extends false
      ? never
      : Key extends keyof DomainActionsOf<TScope>
        ? TAction
        : never
    : never

export type SessionDatasetHandle<TRecord> = Readonly<{
  datasetId: string
  mode: "opened" | "built"
  preview: readonly TRecord[]
  count?: number
}>

export type SessionAgentInput<
  TOutput,
  TActions extends readonly AnyDomainAction[],
  TScope,
> = Readonly<{
  instruction: string
  output: z.ZodType<TOutput>
  actions?: { readonly [Index in keyof TActions]: ActionAllowedInScope<TActions[Index], TScope> }
  model?: ReactionModel
  maxRounds?: number
  datasets?: boolean
}>

export type SessionTextAgentInput<
  TActions extends readonly AnyDomainAction[],
  TScope,
> = Readonly<{
  instruction: string
  output?: never
  actions?: { readonly [Index in keyof TActions]: ActionAllowedInScope<TActions[Index], TScope> }
  model?: ReactionModel
  maxRounds?: number
  datasets?: boolean
}>

export type SessionDatasetInput<TRecord> = Readonly<{
  instruction: string
  schema: z.ZodType<TRecord>
}>

type SessionGitOutput<TInput extends ReactionGitInput> =
  TInput["operation"] extends "clone" ? ReactorGitCloneOutput
    : TInput["operation"] extends "commit" ? ReactorGitCommitOutput
      : ReactorGitPushOutput

export interface SessionFrom<TScope extends DomainLike> {
  agent<
    TOutput,
    const TActions extends readonly AnyDomainAction[] = readonly [],
  >(input: SessionAgentInput<TOutput, TActions, TScope>): Promise<ContextEvent<TOutput>>
  agent<
    const TActions extends readonly AnyDomainAction[] = readonly [],
  >(input: SessionTextAgentInput<TActions, TScope>): Promise<ContextEvent<string>>
  action<TAction extends AnyDomainAction>(
    action: ActionAllowedInScope<TAction, TScope>,
    input: DomainActionInput<TAction>,
  ): Promise<ContextEvent<DomainActionOutput<TAction>>>
  dataset<TRecord>(
    input: SessionDatasetInput<TRecord>,
  ): Promise<ContextEvent<SessionDatasetHandle<TRecord>>>
  loadFiles(): Promise<ContextEvent<ReactorLoadFilesOutput>>
  storeFiles(input: ReactorStoreFilesInput): Promise<ContextEvent<ReactorStoreFilesOutput>>
  shell(input: ReactorShellRunInput): Promise<ContextEvent<ReactorShellRunOutput>>
  git<const TInput extends ReactionGitInput>(
    input: TInput,
  ): Promise<ContextEvent<SessionGitOutput<TInput>>>
}

export type SessionConfig<
  TContext,
  TScope extends DomainLike,
> = Readonly<{
  scope: TScope
  engine: AnyReactionEngine<TContext> | false
  sandbox?: ReactionSandbox<TContext> | false
}>

type SessionRuntime = ContextRuntimeServiceHandle & {
  use(domain: DomainLike, options?: unknown): Promise<unknown>
  env?: unknown
  materializeDataset?: any
}

type PreparedSession = Readonly<{
  context: ReactorInitialContext<unknown>
  trigger: ContextEvent
  sessionId: string
  rootReactionId: string
  sandboxId: string | false
}>

const OPERATION_REACTION_NAMESPACE = "a74bf5d0-b929-49da-b032-0e92b3ec27c5"
const OPERATION_EVENT_NAMESPACE = "09e6f898-243b-42ec-bf37-c443d78817fb"
const sessionIds = new WeakMap<object, string>()

export class Session<
  TContext,
  TScope extends DomainLike,
> {
  private rootReactionId: string = globalThis.crypto.randomUUID()
  private nextPosition = 1
  private prepared?: PreparedSession
  private preparing?: Promise<PreparedSession>
  private completing?: Promise<void>
  private lastEvent?: ContextEvent
  private failed?: unknown
  private completed = false

  constructor(
    private readonly runtime: SessionRuntime,
    readonly context: ContextHandle<TContext>,
    private readonly config: SessionConfig<TContext, TScope>,
  ) {
    if (!config?.scope) throw new Error("session_scope_required")
    if (config.engine === undefined) throw new Error("session_engine_declaration_required")
    sessionIds.set(this, globalThis.crypto.randomUUID())
  }

  static [WORKFLOW_SERIALIZE](instance: Session<any, any>) {
    return {
      runtime: instance.runtime,
      context: instance.context,
      config: instance.config,
      rootReactionId: instance.rootReactionId,
      nextPosition: instance.nextPosition,
      prepared: instance.prepared,
      lastEvent: instance.lastEvent,
      failed: instance.failed,
      completed: instance.completed,
      sessionId: getSessionId(instance),
    }
  }

  static [WORKFLOW_DESERIALIZE](data: {
    runtime: SessionRuntime
    context: ContextHandle<unknown>
    config: SessionConfig<unknown, DomainLike>
    rootReactionId: string
    nextPosition: number
    prepared?: PreparedSession
    lastEvent?: ContextEvent
    failed?: unknown
    completed: boolean
    sessionId: string
  }) {
    const session = new Session(data.runtime, data.context, data.config)
    session.rootReactionId = data.rootReactionId
    session.nextPosition = data.nextPosition
    session.prepared = data.prepared
    session.lastEvent = data.lastEvent
    session.failed = data.failed
    session.completed = data.completed
    sessionIds.set(session, data.sessionId)
    return session
  }

  from(source: EventSource<TScope>): SessionFrom<TScope> {
    const points = normalizePoints(source)
    for (const point of points) this.assertPoint(point)
    let resolving: Promise<readonly ContextEvent[]> | undefined
    const resolveEvents = () => {
      resolving ??= this.resolvePoints(points)
      return resolving
    }
    return Object.freeze({
      agent: async (input: any) => {
        this.assertOpen()
        this.assertEngine()
        const actions = input.actions ?? []
        actions.forEach((action: AnyDomainAction) => this.assertAction(action))
        const events = await resolveEvents()
        const datasetEnabled = input.datasets !== false
        const provider = this.runtime.materializeDataset
        if (datasetEnabled && typeof provider !== "function") {
          throw new Error("reaction_dataset_provider_not_configured")
        }
        const dataset = datasetEnabled
          ? Object.freeze({
              domain: describeAgentDatasetDomain(this.config.scope),
              given: deriveDatasetSource(events),
              available: describeAvailableAgentDatasets(events),
            })
          : undefined
        return await this.operation(events, {
          kind: "agent",
          instruction: requiredInstruction(input.instruction),
          ...(input.output
            ? { outputSchema: z.toJSONSchema(input.output, { target: "draft-7" }) }
            : {}),
          actions: actions.map(toReactionOperationActionRef),
          ...(dataset ? { dataset } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.maxRounds === undefined ? {} : { maxRounds: input.maxRounds }),
        })
      },
      action: async (action: AnyDomainAction, input: unknown) => {
        this.assertOpen()
        this.assertAction(action)
        const events = await resolveEvents()
        return await this.operation(events, {
          kind: "action",
          action: toReactionOperationActionRef(action),
          input,
        })
      },
      dataset: async (input: any) => {
        this.assertOpen()
        this.assertEngine()
        if (!input?.schema) throw new Error("reaction_dataset_schema_required")
        const events = await resolveEvents()
        return await this.operation(events, {
          kind: "dataset",
          instruction: requiredInstruction(input.instruction),
          recordSchema: z.toJSONSchema(input.schema, { target: "draft-7" }),
          source: deriveDatasetSource(events),
        })
      },
      loadFiles: async () => {
        this.assertOpen()
        this.assertSandboxConfigured()
        const events = await resolveEvents()
        return await this.operation(events, { kind: "loadFiles" })
      },
      storeFiles: async (input: ReactorStoreFilesInput) => {
        this.assertOpen()
        this.assertSandboxConfigured()
        const events = await resolveEvents()
        return await this.operation(events, { kind: "storeFiles", input })
      },
      shell: async (input: ReactorShellRunInput) => {
        this.assertOpen()
        this.assertSandboxConfigured()
        const events = await resolveEvents()
        return await this.operation(events, { kind: "shell", input })
      },
      git: async (input: ReactionGitInput) => {
        this.assertOpen()
        this.assertSandboxConfigured()
        const events = await resolveEvents()
        return await this.operation(events, { kind: "git", input })
      },
    }) as SessionFrom<TScope>
  }

  async complete(): Promise<void> {
    if (this.completed) return
    if (this.completing) return await this.completing
    this.assertOpen()
    if (this.failed !== undefined) throw this.failed
    this.completing = this.completeNow()
    try {
      await this.completing
    } catch (error) {
      this.failed = error
      throw error
    } finally {
      this.completing = undefined
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.completed || this.failed !== undefined) return
    await this.complete()
  }

  private async completeNow(): Promise<void> {
    const prepared = this.prepared ?? await this.preparing
    if (!prepared) throw new Error("session_not_started")
    if (!this.lastEvent) throw new Error("session_has_no_effect")
    try {
      await finishSession(this.runtime, prepared, this.lastEvent)
      this.completed = true
    } catch (error) {
      await failSession(this.runtime, prepared, error).catch(() => undefined)
      throw error
    }
  }

  private async resolvePoints(
    points: readonly (ContextEvent | AnyDomainEventDraft)[],
  ): Promise<readonly ContextEvent[]> {
    const persisted: ContextEvent[] = []
    for (const point of points) {
      persisted.push(isDomainEventDraft(point)
        ? await this.context.append(point)
        : point)
    }
    return normalizeEvents(persisted)
  }

  private async operation(
    events: readonly ContextEvent[],
    operation: ReactionOperation,
  ): Promise<ContextEvent> {
    const prepared = await this.prepare(events)
    const position = this.nextPosition++
    const type = operation.kind === "git" ? `git.${operation.input.operation}` : operation.kind
    const reactionId = uuidV5(
      `${prepared.sessionId}:${position}:${type}`,
      OPERATION_REACTION_NAMESPACE,
    )
    const eventId = uuidV5(
      `${prepared.sessionId}:${position}:${type}`,
      OPERATION_EVENT_NAMESPACE,
    )
    try {
      const result = await executeSessionOperation({
        runtime: this.runtime,
        context: prepared.context,
        trigger: prepared.trigger,
        definition: "session",
        sessionId: prepared.sessionId,
        rootReactionId: prepared.rootReactionId,
        reactionId,
        eventId,
        position,
        causeIds: events.map(event => event.id),
        engine: this.config.engine as AnyReactionEngine<unknown> | false,
        sandboxId: prepared.sandboxId,
        operation,
      })
      this.lastEvent = result.event
      return result.event
    } catch (error) {
      this.failed = error
      await failSession(this.runtime, prepared, error).catch(() => undefined)
      throw error
    }
  }

  private async prepare(events: readonly ContextEvent[]) {
    if (this.prepared) return this.prepared
    if (!this.preparing) {
      this.preparing = prepareSession({
        runtime: this.runtime,
        context: this.context.context,
        trigger: events[0]!,
        sandbox: this.config.sandbox ?? false,
        sessionId: getSessionId(this),
        rootReactionId: this.rootReactionId,
      }).then(prepared => {
        this.prepared = prepared
        return prepared
      })
    }
    return await this.preparing
  }

  private assertOpen() {
    if (this.completed) throw new Error("session_already_completed")
    if (this.failed !== undefined) throw this.failed
  }

  private assertEngine() {
    if (this.config.engine === false) throw new Error("reaction_engine_not_configured")
  }

  private assertSandboxConfigured() {
    if ((this.config.sandbox ?? false) === false) {
      throw new Error("reaction_sandbox_not_configured")
    }
  }

  private assertAction(action: AnyDomainAction) {
    const binding = getDomainActionBinding(action)
    if (!binding?.id) throw new Error("reaction_action_registration_required")
    const available = new Set(
      getDomainActions(this.config.scope)
        .map(candidate => getDomainActionBinding(candidate)?.id ?? candidate.id),
    )
    if (!available.has(binding.id)) {
      throw new Error(`reaction_action_outside_scope:${binding.id}`)
    }
  }

  private assertPoint(point: ContextEvent | AnyDomainEventDraft) {
    if (isDomainEventDraft(point)) {
      this.assertDomainEvent(point.domain, point.name, point.kind)
      return
    }
    assertContextEvent(point)
    if (point.contextId && point.contextId !== this.context.id) {
      throw new Error(`session_event_outside_context:${point.id}`)
    }
    if (point.domain && point.name) {
      this.assertDomainEvent(point.domain, point.name, point.type)
    }
  }

  private assertDomainEvent(domain: string, name: string, kind: string) {
    const eventMap = typeof (this.config.scope as any).getEventMap === "function"
      ? (this.config.scope as any).getEventMap()
      : {}
    const available = Object.values(eventMap as Record<string, any>).some(event =>
      event?.domain === domain &&
      event?.name === name &&
      event?.kind === kind
    )
    if (!available) throw new Error(`reaction_event_outside_scope:${kind}`)
  }
}

export function getSessionId(session: Session<any, any>): string {
  const id = sessionIds.get(session)
  if (!id) throw new Error("session_identity_not_found")
  return id
}

async function executeSessionOperation(
  request: ReactionOperationRequest,
): Promise<ReactionOperationResult> {
  switch (request.operation.kind) {
    case "agent": return await agentStep(request)
    case "action": return await actionStep(request)
    case "dataset": return await datasetStep(request)
    case "loadFiles": return await loadFilesStep(request)
    case "storeFiles": return await storeFilesStep(request)
    case "shell": return await shellStep(request)
    case "git": return await gitStep(request)
    case "emit": throw new Error("session_emit_not_supported")
  }
}

async function prepareSession<TContext>(input: {
  runtime: SessionRuntime
  context: StoredContext<TContext>
  trigger: ContextEvent
  sandbox: ReactionSandbox<TContext> | false
  sessionId: string
  rootReactionId: string
}): Promise<PreparedSession> {
  const sandboxId = await resolveSandboxId(
    input.sandbox,
    input.runtime,
    input.context.content as TContext,
    input.trigger,
  )
  return await startSession({
    runtime: input.runtime,
    context: input.context,
    trigger: input.trigger,
    sandboxId,
    sessionId: input.sessionId,
    rootReactionId: input.rootReactionId,
  })
}

async function startSession(input: {
  runtime: SessionRuntime
  context: StoredContext<unknown>
  trigger: ContextEvent
  sandboxId: string | false
  sessionId: string
  rootReactionId: string
}): Promise<PreparedSession> {
  "use step"
  const { store } = await getContextRuntimeServices(input.runtime)
  const context = await store.getContext({ id: input.context.id })
  const trigger = await store.getEvent(input.trigger.id)
  if (!context) throw new Error(`session_context_not_found:${input.context.id}`)
  if (!trigger) throw new Error(`session_trigger_not_found:${input.trigger.id}`)
  const workflowRunId = await currentWorkflowRunId()
  await store.openSession({
    id: input.sessionId,
    rootReactionId: input.rootReactionId,
    contextId: input.context.id,
    definition: "session",
    triggerId: trigger.id,
    ...(input.sandboxId === false ? {} : { sandboxId: input.sandboxId }),
    ...(workflowRunId ? { workflowRunId } : {}),
  })
  return Object.freeze({
    context: contextSnapshot(input.context),
    trigger,
    sessionId: input.sessionId,
    rootReactionId: input.rootReactionId,
    sandboxId: input.sandboxId,
  })
}

async function finishSession(
  runtime: SessionRuntime,
  prepared: PreparedSession,
  effect: ContextEvent,
) {
  "use step"
  const { store } = await getContextRuntimeServices(runtime)
  if (!(await store.getEvent(effect.id))) {
    throw new Error(`session_effect_not_persisted:${effect.id}`)
  }
  await store.completeReaction(prepared.rootReactionId, "completed", [effect.id])
  await store.completeSession(prepared.sessionId, "completed")
}

async function failSession(
  runtime: SessionRuntime,
  prepared: PreparedSession,
  error: unknown,
) {
  "use step"
  const { store } = await getContextRuntimeServices(runtime)
  await store.completeReaction(prepared.rootReactionId, "failed", [], error)
  await store.completeSession(prepared.sessionId, "failed", error)
}

function normalizePoints<TScope extends DomainLike>(
  source: EventSource<TScope>,
): readonly (ContextEvent | AnyDomainEventDraft)[] {
  const values = Array.isArray(source) ? source : [source]
  if (values.length === 0) throw new Error("session_from_event_required")
  for (const value of values) {
    if (!isDomainEventDraft(value)) assertContextEvent(value)
  }
  return Object.freeze([...values]) as readonly (ContextEvent | AnyDomainEventDraft)[]
}

function normalizeEvents(values: readonly ContextEvent[]): readonly ContextEvent[] {
  const events: ContextEvent[] = []
  const seen = new Set<string>()
  for (const value of values) {
    assertContextEvent(value)
    if (!seen.has(value.id)) {
      seen.add(value.id)
      events.push(value)
    }
  }
  return Object.freeze(events)
}

function isDomainEventDraft(value: unknown): value is AnyDomainEventDraft {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as any).kind === "string" &&
      typeof (value as any).domain === "string" &&
      typeof (value as any).name === "string" &&
      typeof (value as any).link === "function" &&
      (value as any).definition &&
      typeof (value as any).definition === "object",
  )
}

function assertContextEvent(value: unknown): asserts value is ContextEvent {
  if (
    !value || typeof value !== "object" ||
    typeof (value as any).id !== "string" ||
    typeof (value as any).type !== "string" ||
    !((value as any).createdAt instanceof Date)
  ) {
    throw new Error("session_event_required")
  }
}

function contextSnapshot(context: any): ReactorInitialContext<unknown> {
  return Object.freeze({
    ref: Object.freeze({ id: context.id, key: context.key ?? null }),
    content: Object.freeze((context.content ?? {}) as object),
    ...(context.previous === undefined
      ? {}
      : { previous: Object.freeze(context.previous as object) }),
  })
}

function requiredInstruction(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("reaction_instruction_required")
  }
  return value.trim()
}

async function resolveSandboxId<TContext>(
  configured: ReactionSandbox<TContext> | false,
  runtime: SessionRuntime,
  context: TContext,
  trigger: ContextEvent,
) {
  if (configured === false) return false
  const value = typeof configured === "function"
    ? await configured({ runtime, context, trigger, reactionKey: "session" })
    : configured
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("reaction_sandbox_id_required")
  }
  return value.trim()
}

async function currentWorkflowRunId() {
  try {
    const { getWorkflowMetadata } = await import("workflow")
    const value = getWorkflowMetadata?.()?.workflowRunId
    return value === undefined || value === null || value === ""
      ? undefined
      : String(value)
  } catch {
    return undefined
  }
}

import {
  getDomainActions,
  type DomainActionBelongsTo,
  type DomainActionInput,
  type DomainActionOutput,
  type DomainActionRegistration,
  type DomainEventConstructor,
  type DomainEventDraft,
  type DomainLike,
} from "@ekairos/domain"
import { getDomainActionBinding } from "@ekairos/domain/internal"
import {
  ContextHandle,
  getContextRuntimeServices,
  uuidV5,
  type ContextEvent,
  type ContextRuntimeServiceHandle,
  type DomainEventItem,
  type StoredContext,
} from "@ekairos/events"
import { z } from "zod"

import {
  deriveDatasetSource,
  executeReactionOperation,
  toReactionOperationActionRef,
  type ReactionGitInput,
  type ReactionOperation,
} from "./reaction.operation.js"
import type {
  AnyReactionEngine,
  ReactionModel,
  ReactionSandbox,
  ReactorGitCloneOutput,
  ReactorGitCommitOutput,
  ReactorGitPushOutput,
  ReactorInitialContext,
  ReactorShellRunInput,
  ReactorShellRunOutput,
  ReactorWorkspaceInput,
  ReactorWorkspaceOutput,
  TriggerEventItem,
} from "./reactor.js"
import {
  persistReactionWorkflowRun,
  readReactionWorkflowReturnValue,
  resumeReactionReturnHook,
  serializeReactionError,
  startReactionWorkflow,
  unwrapReactionReturnHook,
  type ReactionCompletion,
  type ReactionReturnHookPayload,
  type ReactionWorkflow,
  type ReactionWorkflowPayload,
} from "./reactor.durable.js"

type AnyDomainEventConstructor = DomainEventConstructor<any, any, any, any, any>
type AnyDomainAction = DomainActionRegistration<any, any, any, any>
type EventSource = ContextEvent | readonly ContextEvent[]

type ActionAllowedInScope<TAction, TScope> =
  TAction extends AnyDomainAction
    ? DomainActionBelongsTo<TAction, TScope> extends false ? never : TAction
    : never

type EffectPayload<TDraft> =
  TDraft extends DomainEventDraft<infer TPayload, any, any, any, any, any>
    ? TPayload
    : never

export type ReactionEffect = ContextEvent | readonly ContextEvent[]

export type ReactionDatasetHandle<TRecord> = Readonly<{
  datasetId: string
  mode: "opened" | "built"
  preview: readonly TRecord[]
  count?: number
}>

export type ReactionAgentInput<
  TOutput,
  TActions extends readonly AnyDomainAction[],
  TScope,
> = Readonly<{
  instruction: string
  output: z.ZodType<TOutput>
  actions?: { readonly [Index in keyof TActions]: ActionAllowedInScope<TActions[Index], TScope> }
  model?: ReactionModel
  maxRounds?: number
}>

export type ReactionTextAgentInput<
  TActions extends readonly AnyDomainAction[],
  TScope,
> = Readonly<{
  instruction: string
  output?: never
  actions?: { readonly [Index in keyof TActions]: ActionAllowedInScope<TActions[Index], TScope> }
  model?: ReactionModel
  maxRounds?: number
}>

export type ReactionDatasetInput<TRecord> = Readonly<{
  instruction: string
  schema: z.ZodType<TRecord>
}>

type ReactionGitOutput<TInput extends ReactionGitInput> =
  TInput["operation"] extends "clone" ? ReactorGitCloneOutput
    : TInput["operation"] extends "commit" ? ReactorGitCommitOutput
      : ReactorGitPushOutput

export interface GivenOperations<TScope extends DomainLike> {
  agent<
    TOutput,
    const TActions extends readonly AnyDomainAction[] = readonly [],
  >(input: ReactionAgentInput<TOutput, TActions, TScope>): Promise<ContextEvent<TOutput>>
  agent<
    const TActions extends readonly AnyDomainAction[] = readonly [],
  >(input: ReactionTextAgentInput<TActions, TScope>): Promise<ContextEvent<string>>
  action<TAction extends AnyDomainAction>(
    action: ActionAllowedInScope<TAction, TScope>,
    input: DomainActionInput<TAction>,
  ): Promise<ContextEvent<DomainActionOutput<TAction>>>
  dataset<TRecord>(
    input: ReactionDatasetInput<TRecord>,
  ): Promise<ContextEvent<ReactionDatasetHandle<TRecord>>>
  workspace(input: ReactorWorkspaceInput): Promise<ContextEvent<ReactorWorkspaceOutput>>
  shell(input: ReactorShellRunInput): Promise<ContextEvent<ReactorShellRunOutput>>
  git<const TInput extends ReactionGitInput>(
    input: TInput,
  ): Promise<ContextEvent<ReactionGitOutput<TInput>>>
  emit<TDraft extends DomainEventDraft<any, any, any, any, any, any>>(
    draft: TDraft,
  ): Promise<DomainEventItem<EffectPayload<TDraft>>>
}

export type ReactionContext<TContext> = Readonly<{
  id: string
  key?: string
  content: Readonly<TContext>
  previous?: Readonly<TContext>
}>

export interface ReactionRun<
  TContext,
  TScope extends DomainLike,
  TTrigger extends AnyDomainEventConstructor,
> {
  readonly id: string
  readonly trigger: TriggerEventItem<TTrigger>
  readonly context: ReactionContext<TContext>
  readonly sandboxId?: string
  given(source: EventSource): GivenOperations<TScope>
  react<TEffect extends ReactionEffect>(
    trigger: ContextEvent,
    definition: ReactionDefinition<any, any, any, TEffect>,
  ): Promise<TEffect>
  react<TEffect extends ReactionEffect>(
    context: ContextHandle<any>,
    trigger: ContextEvent,
    definition: ReactionDefinition<any, any, any, TEffect>,
  ): Promise<TEffect>
}

export type ReactionDefinitionOptions<
  TContext,
  TScope extends DomainLike,
> = Readonly<{
  key: string
  scope: TScope
  engine: AnyReactionEngine<TContext> | false
  sandbox: ReactionSandbox<TContext> | false
}>

const REACTION_DEFINITION = Symbol("@ekairos/reactor/reaction-definition")
const OPERATION_REACTION_NAMESPACE = "a74bf5d0-b929-49da-b032-0e92b3ec27c5"
const OPERATION_EVENT_NAMESPACE = "09e6f898-243b-42ec-bf37-c443d78817fb"

type ReactionHandler<
  TContext,
  TScope extends DomainLike,
  TTrigger extends AnyDomainEventConstructor,
  TEffect extends ReactionEffect,
> = (reaction: ReactionRun<TContext, TScope, TTrigger>) => Promise<TEffect> | TEffect

type ReactionDefinitionInternals<
  TContext,
  TScope extends DomainLike,
  TTrigger extends AnyDomainEventConstructor,
  TEffect extends ReactionEffect,
> = Readonly<{
  options: ReactionDefinitionOptions<TContext, TScope>
  handler: ReactionHandler<TContext, TScope, TTrigger, TEffect>
}>

export type ReactionDefinition<
  TContext = unknown,
  TScope extends DomainLike = DomainLike,
  TTrigger extends AnyDomainEventConstructor = AnyDomainEventConstructor,
  TEffect extends ReactionEffect = ReactionEffect,
> = Readonly<{
  key: string
  trigger: TTrigger
  scope: TScope
  readonly [REACTION_DEFINITION]: ReactionDefinitionInternals<TContext, TScope, TTrigger, TEffect>
}>

export type ReactOptions = Readonly<{
  workflow?: ReactionWorkflow
  parentSessionId?: string
}>

export function defineReaction<
  TTrigger extends AnyDomainEventConstructor,
  TContext = unknown,
  TScope extends DomainLike = DomainLike,
  TEffect extends ReactionEffect = ReactionEffect,
>(
  trigger: TTrigger,
  options: ReactionDefinitionOptions<TContext, TScope>,
  handler: ReactionHandler<TContext, TScope, TTrigger, TEffect>,
): ReactionDefinition<TContext, TScope, TTrigger, TEffect> {
  if (typeof trigger !== "function") throw new Error("reaction_trigger_constructor_required")
  if (!options?.key?.trim()) throw new Error("reaction_key_required")
  if (!options.scope) throw new Error("reaction_scope_required")
  if (options.engine === undefined) throw new Error("reaction_engine_declaration_required")
  if (options.sandbox === undefined) throw new Error("reaction_sandbox_declaration_required")
  if (typeof handler !== "function") throw new Error("reaction_handler_required")
  assertEventInScope(options.scope, trigger)
  return Object.freeze({
    key: options.key.trim(),
    trigger,
    scope: options.scope,
    [REACTION_DEFINITION]: Object.freeze({ options, handler }),
  })
}

type ReactionRuntime = ContextRuntimeServiceHandle & {
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

class ActiveReaction<
  TContext,
  TScope extends DomainLike,
  TTrigger extends AnyDomainEventConstructor,
> implements ReactionRun<TContext, TScope, TTrigger> {
  readonly id: string
  readonly trigger: TriggerEventItem<TTrigger>
  readonly context: ReactionContext<TContext>
  readonly sandboxId?: string
  private nextPosition = 1

  constructor(private readonly input: {
    runtime: ReactionRuntime
    contextHandle: ContextHandle<TContext>
    prepared: PreparedSession
    definition: ReactionDefinition<TContext, TScope, TTrigger, any>
  }) {
    this.id = input.prepared.sessionId
    this.trigger = input.prepared.trigger as TriggerEventItem<TTrigger>
    this.context = Object.freeze({
      id: input.prepared.context.ref.id,
      ...(input.prepared.context.ref.key ? { key: input.prepared.context.ref.key } : {}),
      content: input.prepared.context.content as Readonly<TContext>,
      ...(input.prepared.context.previous === undefined
        ? {}
        : { previous: input.prepared.context.previous as Readonly<TContext> }),
    })
    this.sandboxId = input.prepared.sandboxId === false
      ? undefined
      : input.prepared.sandboxId
  }

  given(source: EventSource): GivenOperations<TScope> {
    const events = normalizeEvents(source)
    return Object.freeze({
      agent: async (config: any) => {
        this.assertEngine()
        const actions = config.actions ?? []
        actions.forEach((action: AnyDomainAction) => this.assertAction(action))
        return await this.operation(events, {
          kind: "agent",
          instruction: requiredInstruction(config.instruction),
          ...(config.output
            ? { outputSchema: z.toJSONSchema(config.output, { target: "draft-7" }) }
            : {}),
          actions: actions.map(toReactionOperationActionRef),
          ...(config.model ? { model: config.model } : {}),
          ...(config.maxRounds === undefined ? {} : { maxRounds: config.maxRounds }),
        })
      },
      action: async (action: AnyDomainAction, value: unknown) => {
        this.assertAction(action)
        return await this.operation(events, {
          kind: "action",
          action: toReactionOperationActionRef(action),
          input: value,
        })
      },
      dataset: async (config: any) => {
        this.assertEngine()
        if (!config?.schema) throw new Error("reaction_dataset_schema_required")
        return await this.operation(events, {
          kind: "dataset",
          instruction: requiredInstruction(config.instruction),
          recordSchema: z.toJSONSchema(config.schema, { target: "draft-7" }),
          source: deriveDatasetSource(events),
        })
      },
      workspace: async (config: ReactorWorkspaceInput) => {
        this.assertSandbox()
        return await this.operation(events, { kind: "workspace", input: config })
      },
      shell: async (config: ReactorShellRunInput) => {
        this.assertSandbox()
        return await this.operation(events, { kind: "shell", input: config })
      },
      git: async (config: ReactionGitInput) => {
        this.assertSandbox()
        return await this.operation(events, { kind: "git", input: config })
      },
      emit: async (draft: DomainEventDraft<any, any, any, any, any, any>) => {
        assertDraftInScope(this.input.definition.scope, draft)
        return await this.operation(events, {
          kind: "emit",
          draft: portableDraft(draft),
          channel: this.trigger.channel,
        })
      },
    }) as GivenOperations<TScope>
  }

  async react<TEffect extends ReactionEffect>(
    first: ContextEvent | ContextHandle<any>,
    second: ContextEvent | ReactionDefinition<any, any, any, TEffect>,
    third?: ReactionDefinition<any, any, any, TEffect>,
  ): Promise<TEffect> {
    const childContext = first instanceof ContextHandle
      ? first
      : this.input.contextHandle
    const trigger = first instanceof ContextHandle ? second as ContextEvent : first
    const definition = first instanceof ContextHandle
      ? third
      : second as ReactionDefinition<any, any, any, TEffect>
    if (!definition) throw new Error("child_reaction_definition_required")
    assertContextEvent(trigger)
    const position = this.nextPosition++
    const boundaryId = uuidV5(
      `${this.id}:${position}:child:${definition.key}`,
      OPERATION_REACTION_NAMESPACE,
    )
    await openChildBoundary({
      runtime: this.input.runtime,
      id: boundaryId,
      sessionId: this.id,
      rootReactionId: this.input.prepared.rootReactionId,
      position,
      triggerId: trigger.id,
      definition: definition.key,
    })
    try {
      const result = await executeReaction(
        this.input.runtime,
        childContext,
        trigger,
        definition,
        { parentSessionId: this.id },
      )
      await completeChildBoundary(
        this.input.runtime,
        boundaryId,
        "completed",
        normalizeEvents(result).map(event => event.id),
      )
      return result
    } catch (error) {
      await completeChildBoundary(this.input.runtime, boundaryId, "failed", [], error)
        .catch(() => undefined)
      throw error
    }
  }

  private async operation(events: readonly ContextEvent[], operation: ReactionOperation) {
    const position = this.nextPosition++
    const type = operation.kind === "git" ? `git.${operation.input.operation}` : operation.kind
    const reactionId = uuidV5(
      `${this.id}:${position}:${type}`,
      OPERATION_REACTION_NAMESPACE,
    )
    const eventId = uuidV5(
      `${this.id}:${position}:${type}`,
      OPERATION_EVENT_NAMESPACE,
    )
    return (await executeReactionOperation({
      runtime: this.input.runtime,
      context: this.input.prepared.context,
      trigger: this.input.prepared.trigger,
      definition: this.input.definition.key,
      sessionId: this.id,
      rootReactionId: this.input.prepared.rootReactionId,
      reactionId,
      eventId,
      position,
      causeIds: events.map(event => event.id),
      engine: this.input.definition[REACTION_DEFINITION].options.engine as AnyReactionEngine<unknown> | false,
      sandboxId: this.input.prepared.sandboxId,
      operation,
    })).event
  }

  private assertEngine() {
    if (this.input.prepared && this.input.definition[REACTION_DEFINITION].options.engine === false) {
      throw new Error("reaction_engine_not_configured")
    }
  }

  private assertSandbox() {
    if (!this.sandboxId) throw new Error("reaction_sandbox_not_configured")
  }

  private assertAction(action: AnyDomainAction) {
    const binding = getDomainActionBinding(action)
    if (!binding?.id) throw new Error("reaction_action_registration_required")
    const available = new Set(
      getDomainActions(this.input.definition.scope)
        .map(candidate => getDomainActionBinding(candidate)?.id ?? candidate.id),
    )
    if (!available.has(binding.id)) {
      throw new Error(`reaction_action_outside_scope:${binding.id}`)
    }
  }
}

export async function executeReaction<
  TContext,
  TScope extends DomainLike,
  TTrigger extends AnyDomainEventConstructor,
  TEffect extends ReactionEffect,
>(
  runtime: ReactionRuntime,
  contextHandle: ContextHandle<TContext>,
  trigger: ContextEvent,
  definition: ReactionDefinition<TContext, TScope, TTrigger, TEffect>,
  options: ReactOptions = {},
): Promise<TEffect> {
  assertContextEvent(trigger)
  assertTrigger(trigger, definition)
  const refreshedContext = await loadReactionContext<TContext>(runtime, contextHandle.id)
  const refreshed = new ContextHandle(runtime, refreshedContext)
  const sandboxId = await resolveSandboxId(
    definition[REACTION_DEFINITION].options.sandbox,
    runtime,
    refreshed.context.content as TContext,
    trigger,
    definition.key,
  )
  const prepared = await prepareSession({
    runtime,
    contextId: refreshed.id,
    triggerId: trigger.id,
    definition: definition.key,
    sandboxId,
    parentSessionId: options.parentSessionId,
  })

  if (!options.workflow) {
    return (await executePreparedReaction(
      runtime,
      new ContextHandle(runtime, refreshed.context),
      prepared,
      definition,
    )).result
  }

  const pendingHook = await createReactionReturnHook(prepared.sessionId)
  const payload: ReactionWorkflowPayload = Object.freeze({
    reactionKey: definition.key,
    runtime,
    contextId: prepared.context.ref.id,
    triggerId: prepared.trigger.id,
    sessionId: prepared.sessionId,
    rootReactionId: prepared.rootReactionId,
    ...(prepared.sandboxId === false ? {} : { sandboxId: prepared.sandboxId }),
    ...(options.parentSessionId ? { parentSessionId: options.parentSessionId } : {}),
    ...(pendingHook ? { returnHookToken: pendingHook.token } : {}),
  })
  let runId = ""
  try {
    runId = (await startReactionWorkflow({ workflow: options.workflow, payload })).runId
    await persistReactionWorkflowRun({ runtime, sessionId: prepared.sessionId, runId })
    const completion = pendingHook
      ? await pendingHook.completion
      : await readReactionWorkflowReturnValue(runId)
    return await hydrateReturnedEvents(runtime, completion) as TEffect
  } catch (error) {
    await failSession(runtime, prepared, error).catch(() => undefined)
    throw error
  }
}

export async function runReactionWorkflow(
  payload: ReactionWorkflowPayload,
  catalog: readonly ReactionDefinition[],
): Promise<ReactionCompletion> {
  try {
    const definition = resolveDefinition(payload.reactionKey, catalog)
    const { context, trigger } = await loadReactionInvocation({
      runtime: payload.runtime,
      contextId: payload.contextId,
      triggerId: payload.triggerId,
    })
    const prepared: PreparedSession = Object.freeze({
      context: contextSnapshot(context),
      trigger,
      sessionId: payload.sessionId,
      rootReactionId: payload.rootReactionId,
      sandboxId: payload.sandboxId ?? false,
    })
    const invocation = await executePreparedReaction(
      payload.runtime as ReactionRuntime,
      new ContextHandle(payload.runtime, context),
      prepared,
      definition as any,
    )
    if (payload.returnHookToken) {
      await resumeReactionReturnHook({
        token: payload.returnHookToken,
        payload: { ok: true, completion: invocation.completion },
      })
    }
    return invocation.completion
  } catch (error) {
    if (payload.returnHookToken) {
      await resumeReactionReturnHook({
        token: payload.returnHookToken,
        payload: { ok: false, error: serializeReactionError(error) },
      })
    }
    throw error
  }
}

async function executePreparedReaction<
  TContext,
  TScope extends DomainLike,
  TTrigger extends AnyDomainEventConstructor,
  TEffect extends ReactionEffect,
>(
  runtime: ReactionRuntime,
  contextHandle: ContextHandle<TContext>,
  prepared: PreparedSession,
  definition: ReactionDefinition<TContext, TScope, TTrigger, TEffect>,
) {
  const active = new ActiveReaction({ runtime, contextHandle, prepared, definition })
  try {
    const result = await definition[REACTION_DEFINITION].handler(active)
    const returned = normalizeEvents(result)
    await assertPersistedEvents(runtime, returned)
    const completion: ReactionCompletion = Object.freeze({
      contextId: prepared.context.ref.id,
      sessionId: prepared.sessionId,
      returned: Object.freeze({
        cardinality: Array.isArray(result) ? "many" : "one",
        eventIds: Object.freeze(returned.map(event => event.id)),
      }),
    })
    await completeSession(runtime, prepared, returned.map(event => event.id))
    return Object.freeze({ result, completion })
  } catch (error) {
    await failSession(runtime, prepared, error).catch(() => undefined)
    throw error
  }
}

async function prepareSession(input: {
  runtime: ReactionRuntime
  contextId: string
  triggerId: string
  definition: string
  sandboxId: string | false
  parentSessionId?: string
}): Promise<PreparedSession> {
  "use step"
  const { store } = await getContextRuntimeServices(input.runtime)
  const context = await store.getContext({ id: input.contextId })
  const trigger = await store.getEvent(input.triggerId)
  if (!context) throw new Error(`reaction_context_not_found:${input.contextId}`)
  if (!trigger) throw new Error(`reaction_trigger_not_found:${input.triggerId}`)
  const sessionId = globalThis.crypto.randomUUID()
  const rootReactionId = globalThis.crypto.randomUUID()
  await store.openSession({
    id: sessionId,
    rootReactionId,
    contextId: context.id,
    definition: input.definition,
    triggerId: trigger.id,
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    ...(input.sandboxId === false ? {} : { sandboxId: input.sandboxId }),
  })
  return Object.freeze({
    context: contextSnapshot(context),
    trigger,
    sessionId,
    rootReactionId,
    sandboxId: input.sandboxId,
  })
}

async function completeSession(
  runtime: ReactionRuntime,
  prepared: PreparedSession,
  effectIds: readonly string[],
) {
  "use step"
  const { store } = await getContextRuntimeServices(runtime)
  await store.completeReaction(prepared.rootReactionId, "completed", effectIds)
  await store.completeSession(prepared.sessionId, "completed")
}

async function failSession(
  runtime: ReactionRuntime,
  prepared: PreparedSession,
  error: unknown,
) {
  "use step"
  const { store } = await getContextRuntimeServices(runtime)
  await store.completeReaction(prepared.rootReactionId, "failed", [], error)
  await store.completeSession(prepared.sessionId, "failed", error)
}

async function openChildBoundary(input: {
  runtime: ReactionRuntime
  id: string
  sessionId: string
  rootReactionId: string
  position: number
  triggerId: string
  definition: string
}) {
  "use step"
  const { store } = await getContextRuntimeServices(input.runtime)
  await store.openReaction({
    id: input.id,
    sessionId: input.sessionId,
    type: "child",
    position: input.position,
    depth: 1,
    causeIds: [input.triggerId],
    parentReactionId: input.rootReactionId,
    instruction: input.definition,
  })
}

async function completeChildBoundary(
  runtime: ReactionRuntime,
  reactionId: string,
  status: "completed" | "failed",
  effectIds: readonly string[],
  error?: unknown,
) {
  "use step"
  const { store } = await getContextRuntimeServices(runtime)
  await store.completeReaction(reactionId, status, effectIds, error)
}

async function hydrateReturnedEvents(
  runtime: ContextRuntimeServiceHandle,
  completion: ReactionCompletion,
) {
  const { store } = await getContextRuntimeServices(runtime)
  const events: ContextEvent[] = []
  for (const id of completion.returned.eventIds) {
    const event = await store.getEvent(id)
    if (!event) throw new Error(`reaction_returned_event_not_found:${id}`)
    events.push(event)
  }
  return completion.returned.cardinality === "one" ? events[0]! : Object.freeze(events)
}

async function assertPersistedEvents(
  runtime: ContextRuntimeServiceHandle,
  events: readonly ContextEvent[],
) {
  "use step"

  const { store } = await getContextRuntimeServices(runtime)
  for (const event of events) {
    if (!(await store.getEvent(event.id))) {
      throw new Error(`reaction_must_return_persisted_event:${event.id}`)
    }
  }
}

async function loadReactionContext<TContext>(
  runtime: ContextRuntimeServiceHandle,
  contextId: string,
): Promise<StoredContext<TContext>> {
  "use step"

  const { store } = await getContextRuntimeServices(runtime)
  const context = await store.getContext({ id: contextId })
  if (!context) throw new Error(`reaction_context_not_found:${contextId}`)
  return context as StoredContext<TContext>
}

async function loadReactionInvocation(input: {
  runtime: ContextRuntimeServiceHandle
  contextId: string
  triggerId: string
}) {
  "use step"

  const { store } = await getContextRuntimeServices(input.runtime)
  const context = await store.getContext({ id: input.contextId })
  const trigger = await store.getEvent(input.triggerId)
  if (!context) throw new Error(`reaction_context_not_found:${input.contextId}`)
  if (!trigger) throw new Error(`reaction_trigger_not_found:${input.triggerId}`)
  return { context, trigger }
}

function normalizeEvents(source: EventSource): readonly ContextEvent[] {
  const values = Array.isArray(source) ? source : [source]
  if (values.length === 0) throw new Error("reaction_given_event_required")
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

function assertContextEvent(value: unknown): asserts value is ContextEvent {
  if (
    !value || typeof value !== "object" ||
    typeof (value as any).id !== "string" ||
    typeof (value as any).type !== "string" ||
    !((value as any).createdAt instanceof Date)
  ) {
    throw new Error("reaction_event_required")
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

function portableDraft(draft: DomainEventDraft<any, any, any, any, any, any>) {
  return Object.freeze({
    payload: draft.payload,
    links: draft.links,
    kind: draft.kind,
    domain: draft.domain,
    name: draft.name,
    physicalLinks: draft.physicalLinks,
  })
}

async function resolveSandboxId<TContext>(
  configured: ReactionSandbox<TContext> | false,
  runtime: ReactionRuntime,
  context: TContext,
  trigger: ContextEvent,
  reactionKey: string,
) {
  if (configured === false) return false
  const value = typeof configured === "function"
    ? await configured({ runtime, context, trigger, reactionKey })
    : configured
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("reaction_sandbox_id_required")
  }
  return value.trim()
}

function assertTrigger(event: ContextEvent, definition: ReactionDefinition<any, any, any, any>) {
  if (
    event.type !== definition.trigger.kind ||
    event.domain !== definition.trigger.domain ||
    event.name !== definition.trigger.name
  ) {
    throw new Error(`reaction_trigger_mismatch:${definition.key}`)
  }
}

function assertEventInScope(scope: DomainLike, event: AnyDomainEventConstructor) {
  const events = typeof (scope as any).getEventMap === "function"
    ? Object.values((scope as any).getEventMap()) as AnyDomainEventConstructor[]
    : []
  if (!events.some(candidate => candidate.kind === event.kind)) {
    throw new Error(`reaction_trigger_outside_scope:${event.kind}`)
  }
}

function assertDraftInScope(
  scope: DomainLike,
  draft: DomainEventDraft<any, any, any, any, any, any>,
) {
  const events = typeof (scope as any).getEventMap === "function"
    ? Object.values((scope as any).getEventMap()) as AnyDomainEventConstructor[]
    : []
  if (!events.some(candidate => candidate.kind === draft.kind)) {
    throw new Error(`reaction_effect_outside_scope:${draft.kind}`)
  }
}

function resolveDefinition(key: string, catalog: readonly ReactionDefinition[]) {
  const matches = catalog.filter(definition => definition.key === key)
  if (matches.length === 0) throw new Error(`reaction_not_in_workflow:${key}`)
  if (matches.length > 1) throw new Error(`reaction_workflow_key_duplicated:${key}`)
  return matches[0]!
}

async function createReactionReturnHook(sessionId: string): Promise<{
  token: string
  completion: Promise<ReactionCompletion>
} | null> {
  try {
    const { createHook, getWorkflowMetadata } = await import("workflow")
    if (!getWorkflowMetadata?.()?.workflowRunId) return null
    const token = `reaction:return:${sessionId}`
    const hook = createHook<ReactionReturnHookPayload>({
      token,
      metadata: { kind: "reaction.return", sessionId },
    })
    return { token, completion: Promise.resolve(hook).then(unwrapReactionReturnHook) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("can only be called inside a workflow")) return null
    throw error
  }
}

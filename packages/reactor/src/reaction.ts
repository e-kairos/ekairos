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
  emit as emitStep,
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
  TriggerEventItem,
} from "./reactor.js"
import type { ReactorPath } from "./workspace-path.js"

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
  path?: ReactorPath
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
  path?: ReactorPath
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
  loadFiles(): Promise<ContextEvent<ReactorLoadFilesOutput>>
  storeFiles(input: ReactorStoreFilesInput): Promise<ContextEvent<ReactorStoreFilesOutput>>
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

type ReactionParent = Readonly<{
  parentSessionId?: string
  parentReactionId?: string
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
          ...(config.path ? { path: config.path } : {}),
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
      loadFiles: async () => {
        this.assertSandbox()
        return await this.operation(events, { kind: "loadFiles" })
      },
      storeFiles: async (config: ReactorStoreFilesInput) => {
        this.assertSandbox()
        return await this.operation(events, { kind: "storeFiles", input: config })
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
    await startChildReaction({
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
        { parentSessionId: this.id, parentReactionId: boundaryId },
      )
      await finishChildReaction(
        this.input.runtime,
        boundaryId,
        "completed",
        normalizeEvents(result).map(event => event.id),
      )
      return result
    } catch (error) {
      await finishChildReaction(this.input.runtime, boundaryId, "failed", [], error)
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

async function executeReactionOperation(
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
    case "emit": return await emitStep(request)
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
  parent: ReactionParent = {},
): Promise<TEffect> {
  assertContextEvent(trigger)
  assertTrigger(trigger, definition)
  const sandboxId = await resolveSandboxId(
    definition[REACTION_DEFINITION].options.sandbox,
    runtime,
    contextHandle.context.content as TContext,
    trigger,
    definition.key,
  )
  const prepared = await startReaction({
    runtime,
    context: contextHandle.context,
    trigger,
    definition: definition.key,
    sandboxId,
    parentSessionId: parent.parentSessionId,
    parentReactionId: parent.parentReactionId,
  })
  return await executePreparedReaction(runtime, contextHandle, prepared, definition)
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
    await finishReaction(runtime, prepared, returned)
    return result
  } catch (error) {
    await failReaction(runtime, prepared, error).catch(() => undefined)
    throw error
  }
}

async function startReaction(input: {
  runtime: ReactionRuntime
  context: StoredContext<unknown>
  trigger: ContextEvent
  definition: string
  sandboxId: string | false
  parentSessionId?: string
  parentReactionId?: string
}): Promise<PreparedSession> {
  "use step"
  const { store } = await getContextRuntimeServices(input.runtime)
  const context = await store.getContext({ id: input.context.id })
  const trigger = await store.getEvent(input.trigger.id)
  if (!context) throw new Error(`reaction_context_not_found:${input.context.id}`)
  if (!trigger) throw new Error(`reaction_trigger_not_found:${input.trigger.id}`)
  const sessionId = globalThis.crypto.randomUUID()
  const rootReactionId = globalThis.crypto.randomUUID()
  const workflowRunId = await currentWorkflowRunId()
  await store.openSession({
    id: sessionId,
    rootReactionId,
    contextId: input.context.id,
    definition: input.definition,
    triggerId: trigger.id,
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    ...(input.parentReactionId ? { parentReactionId: input.parentReactionId } : {}),
    ...(input.sandboxId === false ? {} : { sandboxId: input.sandboxId }),
    ...(workflowRunId ? { workflowRunId } : {}),
  })
  return Object.freeze({
    context: contextSnapshot(input.context),
    trigger,
    sessionId,
    rootReactionId,
    sandboxId: input.sandboxId,
  })
}

async function finishReaction(
  runtime: ReactionRuntime,
  prepared: PreparedSession,
  effects: readonly ContextEvent[],
) {
  "use step"
  const { store } = await getContextRuntimeServices(runtime)
  for (const event of effects) {
    if (!(await store.getEvent(event.id))) {
      throw new Error(`reaction_must_return_persisted_event:${event.id}`)
    }
  }
  const effectIds = effects.map(event => event.id)
  await store.completeReaction(prepared.rootReactionId, "completed", effectIds)
  await store.completeSession(prepared.sessionId, "completed")
}

async function failReaction(
  runtime: ReactionRuntime,
  prepared: PreparedSession,
  error: unknown,
) {
  "use step"
  const { store } = await getContextRuntimeServices(runtime)
  await store.completeReaction(prepared.rootReactionId, "failed", [], error)
  await store.completeSession(prepared.sessionId, "failed", error)
}

async function startChildReaction(input: {
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

async function finishChildReaction(
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

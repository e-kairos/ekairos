import { randomUUID } from "node:crypto"

import type { DomainLike } from "@ekairos/domain"
import {
  ContextHandle,
  Part,
  getContextRuntimeServices,
  type ContextIdentifier,
  type ContextItem,
  type ContextPartEnvelope,
  type ContextRuntimeServiceHandle,
  type ContextSandboxSession,
} from "@ekairos/events"
import { z } from "zod"

export type EmptyReactorContext = Record<never, never>
export type EmptyReactorEnv = Record<string, never>

export type ReactorContextRef =
  | ContextIdentifier
  | ContextHandle<unknown>
  | null
  | undefined

export type ReactorInitialContext<TContext> = Readonly<{
  ref: {
    id: string
    key: string | null
  }
  content: Readonly<TContext>
}>

type ReactorScopeDomain = DomainLike & {
  (runtime: any, options?: unknown): Promise<unknown>
}

type ReactorRuntimeScope<TScopeDomain, TRuntime> =
  [TScopeDomain] extends [undefined]
    ? undefined
    : TScopeDomain extends {
        (runtime: TRuntime, options?: unknown): Promise<infer Scope>
      }
      ? Awaited<Scope>
      : never

export type ReactorReadOnlyScope = {
  domain?: unknown
  schema?: unknown
  context?: unknown
  contextString?: unknown
  env?: unknown
  query?: unknown
  db?: {
    query?: unknown
  }
}

export type ReactorAction = (...args: any[]) => Promise<unknown> | unknown
export type ReactorActionMap = Record<string, ReactorAction>

type ContextFromSchema<TContextSchema> =
  TContextSchema extends z.ZodType<infer Context>
    ? Context
    : EmptyReactorContext

type OutputFromSchema<TOutputSchema> =
  TOutputSchema extends z.ZodType<infer Output>
    ? Output
    : unknown

type ReactorReactOptions<TEnv, TContext> =
  keyof TContext extends never
    ? {
        env: TEnv
        context?: TContext
      } & ReactorReactRuntimeOptions<TEnv, TContext>
    : {
        env: TEnv
        context: TContext
      } & ReactorReactRuntimeOptions<TEnv, TContext>

export type ReactorSandboxProvider = {
  kind: string
  createSession(options?: {
    sandboxId?: string
    workspaceRoot?: string
  }): Promise<ContextSandboxSession>
}

export type ReactorSandboxFactoryInput<TEnv, TContext> = {
  env: TEnv
  context: TContext
  triggerEvent: ContextItem
  reactorKey: string
}

export type ReactorSandboxInput<TEnv = unknown, TContext = unknown> =
  | ContextSandboxSession
  | ReactorSandboxProvider
  | ((
      input: ReactorSandboxFactoryInput<TEnv, TContext>,
    ) => ContextSandboxSession | ReactorSandboxProvider | Promise<ContextSandboxSession | ReactorSandboxProvider>)

export type ReactorReactRuntimeOptions<TEnv, TContext> = {
  sandbox?: ReactorSandboxInput<TEnv, TContext>
}

export type ReactorEngineStepInput<
  TContext,
  TEnv,
  TOutput,
  TActions extends ReactorActionMap,
> = {
  reactorKey: string
  context: ReactorInitialContext<TContext>
  scope: ReactorReadOnlyScope
  env: TEnv
  triggerEvent: ContextItem
  executionId: string
  sandbox?: ContextSandboxSession
  workspaceRoot?: string
  step: {
    key: string
    instructions: string
    payload?: unknown
    output?: z.ZodType<TOutput>
  }
  actions: TActions
}

export type ReactorEngine<TContext, TEnv> = {
  step<TOutput, TActions extends ReactorActionMap>(
    input: ReactorEngineStepInput<TContext, TEnv, TOutput, TActions>,
  ): Promise<TOutput | unknown>
}

export type ReactorStepConfig<
  TOutput,
  TActions extends ReactorActionMap,
> = {
  instructions: string
  payload?: unknown
  output?: z.ZodType<TOutput>
  actions?: TActions
  parts?: ContextPartEnvelope[]
}

export type ReactorStepResult<TOutput = unknown> = {
  id: string
  key: string
  output: TOutput
}

export type ReactorCompleteInput<TOutput = unknown> = {
  message?: string
  output?: TOutput
  step?: ReactorStepResult<TOutput>
}

export type ReactorCompleteResult<TOutput = unknown> = {
  executionId: string
  reactionEvent: ContextItem
  output: TOutput | undefined
}

export class ReactorExecution<TContext, TEnv, TFinalOutput = unknown> {
  private nextIteration = 0
  private completedResult: ReactorCompleteResult<TFinalOutput> | null = null

  constructor(
    private readonly params: {
      reactorKey: string
      runtime: ContextRuntimeServiceHandle
      contextHandle: ContextHandle<TContext>
      initialContext: ReactorInitialContext<TContext>
      triggerEvent: ContextItem
      reactionEvent: ContextItem
      executionId: string
      readOnlyScope: ReactorReadOnlyScope
      env: TEnv
      engine?: ReactorEngine<TContext, TEnv>
      output?: z.ZodType<TFinalOutput>
      sandbox?: ContextSandboxSession
    },
  ) {}

  get id() {
    return this.params.executionId
  }

  get context() {
    return this.params.initialContext
  }

  get triggerEvent() {
    return this.params.triggerEvent
  }

  get reactionEvent() {
    return this.params.reactionEvent
  }

  get completed() {
    return this.completedResult !== null
  }

  get sandbox() {
    return this.params.sandbox
  }

  get workspaceRoot() {
    return this.params.sandbox?.workspaceRoot
  }

  get result() {
    return this.completedResult
  }

  async step<
    TOutput = unknown,
    TActions extends ReactorActionMap = Record<string, never>,
  >(
    key: string,
    config: ReactorStepConfig<TOutput, TActions>,
  ): Promise<ReactorStepResult<TOutput>> {
    const stepKey = normalizeStepKey(key)
    const instructions = normalizeInstructions(config.instructions, stepKey)
    const actions = config.actions ?? ({} as TActions)
    const actionNames = Object.keys(actions)

    const { store } = await getContextRuntimeServices(this.params.runtime)
    const step = await this.params.contextHandle.createStep({
      executionId: this.params.executionId,
      iteration: this.nextIteration++,
    })

    try {
      const output = await this.runStepEngine(stepKey, {
        instructions,
        payload: config.payload,
        output: config.output,
        actions,
      })
      const parsedOutput = config.output
        ? config.output.parse(output)
        : (output as TOutput)

      await this.params.contextHandle.saveStepParts({
        stepId: step.id,
        parts: buildStepParts({
          key: stepKey,
          instructions,
          payload: config.payload,
          actions: actionNames,
          output: parsedOutput,
          extraParts: config.parts,
        }),
      })
      await store.updateStep(step.id, {
        status: "completed",
      })

      return {
        id: step.id,
        key: stepKey,
        output: parsedOutput,
      }
    } catch (error) {
      await this.params.contextHandle.saveStepParts({
        stepId: step.id,
        parts: buildStepParts({
          key: stepKey,
          instructions,
          payload: config.payload,
          actions: actionNames,
          error,
          extraParts: config.parts,
        }),
      })
      await store.updateStep(step.id, {
        status: "failed",
        errorText: errorMessage(error),
      })
      throw error
    }
  }

  async complete(
    input: ReactorCompleteInput<TFinalOutput> | ReactorStepResult<TFinalOutput> = {},
  ): Promise<ReactorCompleteResult<TFinalOutput>> {
    if (this.completedResult) {
      throw new Error(`Reactor execution ${this.params.executionId} is already completed.`)
    }

    const normalized = normalizeCompleteInput(input)
    const output = this.params.output
      ? this.params.output.parse(normalized.output)
      : normalized.output

    let finalStepId = normalized.step?.id
    if (!finalStepId || normalized.message) {
      const { store } = await getContextRuntimeServices(this.params.runtime)
      const completeStep = await this.params.contextHandle.createStep({
        executionId: this.params.executionId,
        iteration: this.nextIteration++,
      })
      await this.params.contextHandle.saveStepParts({
        stepId: completeStep.id,
        parts: buildStepParts({
          key: "complete",
          instructions: normalized.message ?? "Complete the reactor execution.",
          payload: normalized.step
            ? {
                stepId: normalized.step.id,
                stepKey: normalized.step.key,
              }
            : undefined,
          actions: [],
          output,
          extraParts: normalized.message ? [Part.message(normalized.message)] : undefined,
        }),
      })
      await store.updateStep(completeStep.id, {
        status: "completed",
      })
      finalStepId = completeStep.id
    }

    const { store } = await getContextRuntimeServices(this.params.runtime)
    const reactionEvent = await store.updateItem(this.params.reactionEvent.id, {
      ...this.params.reactionEvent,
      status: "completed",
      content: {
        ...(this.params.reactionEvent.content ?? {}),
        final: output,
        finalStepId,
      },
    })
    await store.completeExecution(
      this.params.contextHandle.identifier(),
      this.params.executionId,
      "completed",
    )

    this.completedResult = {
      executionId: this.params.executionId,
      reactionEvent,
      output,
    }
    return this.completedResult
  }

  private async runStepEngine<
    TOutput,
    TActions extends ReactorActionMap,
  >(
    key: string,
    config: {
      instructions: string
      payload?: unknown
      output?: z.ZodType<TOutput>
      actions: TActions
    },
  ): Promise<TOutput | unknown> {
    if (!this.params.engine) {
      if (config.output) {
        throw new Error(
          `Reactor ${this.params.reactorKey} step "${key}" requires an engine because it declares output.`,
        )
      }
      return undefined
    }

    return await this.params.engine.step<TOutput, TActions>({
      reactorKey: this.params.reactorKey,
      context: this.params.initialContext,
      scope: this.params.readOnlyScope,
      env: this.params.env,
      triggerEvent: this.params.triggerEvent,
      executionId: this.params.executionId,
      sandbox: this.params.sandbox,
      workspaceRoot: this.params.sandbox?.workspaceRoot,
      step: {
        key,
        instructions: config.instructions,
        payload: config.payload,
        output: config.output,
      },
      actions: config.actions,
    })
  }
}

export type ReactorRunInput<
  TContext,
  TEnv,
  TRuntime,
  TScopeDomain,
  TFinalOutput,
> = {
  runtime: TRuntime
  scope: ReactorRuntimeScope<TScopeDomain, TRuntime>
  env: TEnv
  context: ReactorInitialContext<TContext>
  triggerEvent: ContextItem
  execution: ReactorExecution<TContext, TEnv, TFinalOutput>
  sandbox?: ContextSandboxSession
  workspaceRoot?: string
}

type BaseReactorConfig<
  TKey extends string,
  TContext,
  TEnv,
  TRuntime,
  TScopeDomain,
  TOutputSchema,
> = {
  key: TKey
  scope?: TScopeDomain
  output?: TOutputSchema
  engine?: ReactorEngine<TContext, TEnv>
  sandbox?: ReactorSandboxInput<TEnv, TContext>
  run(
    input: ReactorRunInput<
      TContext,
      TEnv,
      TRuntime,
      TScopeDomain,
      OutputFromSchema<TOutputSchema>
    >,
  ): Promise<void> | void
}

export type ReactorConfigWithContext<
  TKey extends string,
  TContextSchema extends z.ZodType,
  TEnv,
  TRuntime,
  TScopeDomain,
  TOutputSchema,
> = BaseReactorConfig<
  TKey,
  z.output<TContextSchema>,
  TEnv,
  TRuntime,
  TScopeDomain,
  TOutputSchema
> & {
  context: TContextSchema
}

export type ReactorConfigWithoutContext<
  TKey extends string,
  TEnv,
  TRuntime,
  TScopeDomain,
  TOutputSchema,
> = BaseReactorConfig<
  TKey,
  EmptyReactorContext,
  TEnv,
  TRuntime,
  TScopeDomain,
  TOutputSchema
> & {
  context?: undefined
}

type InternalReactorConfig<
  TKey extends string,
  TContext,
  TEnv,
  TRuntime,
  TScopeDomain,
  TOutputSchema,
> = BaseReactorConfig<
  TKey,
  TContext,
  TEnv,
  TRuntime,
  TScopeDomain,
  TOutputSchema
> & {
  context?: z.ZodType<TContext>
}

export class DefinedReactor<
  TContext,
  TEnv,
  TRuntime extends ContextRuntimeServiceHandle,
  TScopeDomain,
  TFinalOutput,
> {
  constructor(
    private readonly config: InternalReactorConfig<
      string,
      TContext,
      TEnv,
      TRuntime,
      TScopeDomain,
      z.ZodType<TFinalOutput> | undefined
    >,
    private readonly runtime: TRuntime,
  ) {}

  get key() {
    return this.config.key
  }

  async react(
    contextRef: ReactorContextRef,
    triggerEvent: ContextItem,
    options: ReactorReactOptions<TEnv, TContext>,
  ) {
    const scope = await resolveReactorRuntimeScope<TScopeDomain, TRuntime>(
      this.config.scope,
      this.runtime,
    )
    const readOnlyScope = createReadOnlyScope(scope)
    const content = parseInitialContext(this.config.context, options.context)
    const sandboxResolution = await resolveReactorSandbox({
      configured: options.sandbox ?? this.config.sandbox,
      env: options.env,
      context: content,
      triggerEvent,
      reactorKey: this.config.key,
    })
    const contextHandle = await resolveContextHandle<TContext>({
      runtime: this.runtime,
      contextRef,
      reactorKey: this.config.key,
      content,
    })
    const { store } = await getContextRuntimeServices(this.runtime)
    if (contextHandle.context.status === "closed") {
      await store.updateContextStatus(contextHandle.identifier(), "open_idle")
    }

    const initialContext: ReactorInitialContext<TContext> = Object.freeze({
      ref: {
        id: contextHandle.id,
        key: contextHandle.key,
      },
      content: deepReadonly(content),
    })

    const opened = await contextHandle.openExecution({ triggerEvent })
    const execution = new ReactorExecution<TContext, TEnv, TFinalOutput>({
      reactorKey: this.config.key,
      runtime: this.runtime,
      contextHandle,
      initialContext,
      triggerEvent: opened.trigger,
      reactionEvent: opened.reaction,
      executionId: opened.execution.id,
      readOnlyScope,
      env: options.env,
      engine: this.config.engine,
      output: this.config.output,
      sandbox: sandboxResolution.session,
    })

    if (sandboxResolution.session) {
      await contextHandle.prepareExecutionSandbox({
        sandbox: sandboxResolution.session,
        executionId: opened.execution.id,
        triggerEventId: opened.trigger.id,
        reactionEventId: opened.reaction.id,
      })
    }

    try {
      await this.config.run({
        runtime: this.runtime,
        scope,
        env: options.env,
        context: initialContext,
        triggerEvent: opened.trigger,
        execution,
        sandbox: sandboxResolution.session,
        workspaceRoot: sandboxResolution.session?.workspaceRoot,
      })
      if (!execution.completed) {
        throw new Error(
          `Reactor ${this.config.key} finished without calling execution.complete().`,
        )
      }
    } catch (error) {
      await store.updateItem(opened.reaction.id, {
        ...opened.reaction,
        status: "pending",
        content: {
          ...(opened.reaction.content ?? {}),
          error: serializeError(error),
        },
      })
      await store.completeExecution(
        contextHandle.identifier(),
        opened.execution.id,
        "failed",
      )
      throw error
    } finally {
      if (sandboxResolution.owned && sandboxResolution.session) {
        await sandboxResolution.session.stop?.()
      }
    }

    return {
      context: initialContext,
      executionId: opened.execution.id,
      reactionEventId: opened.reaction.id,
      result: execution.result,
    }
  }
}

async function resolveReactorSandbox<TEnv, TContext>(params: {
  configured?: ReactorSandboxInput<TEnv, TContext>
  env: TEnv
  context: TContext
  triggerEvent: ContextItem
  reactorKey: string
}): Promise<{ session?: ContextSandboxSession; owned: boolean }> {
  if (!params.configured) return { owned: false }

  const resolved =
    typeof params.configured === "function"
      ? await params.configured({
          env: params.env,
          context: params.context,
          triggerEvent: params.triggerEvent,
          reactorKey: params.reactorKey,
        })
      : params.configured

  if (isSandboxSession(resolved)) {
    return { session: resolved, owned: false }
  }

  if (isSandboxProvider(resolved)) {
    return {
      session: await resolved.createSession(),
      owned: true,
    }
  }

  throw new Error("Reactor sandbox must be a SandboxSession or SandboxSessionProvider.")
}

function isSandboxSession(value: unknown): value is ContextSandboxSession {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as ContextSandboxSession).id === "string" &&
      typeof (value as ContextSandboxSession).workspaceRoot === "string" &&
      typeof (value as ContextSandboxSession).writeFile === "function",
  )
}

function isSandboxProvider(value: unknown): value is ReactorSandboxProvider {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as ReactorSandboxProvider).kind === "string" &&
      typeof (value as ReactorSandboxProvider).createSession === "function",
  )
}

export type ReactorFactory<
  TContext,
  TEnv,
  TRuntime extends ContextRuntimeServiceHandle,
  TScopeDomain,
  TFinalOutput,
> = (
  runtime: TRuntime,
) => DefinedReactor<TContext, TEnv, TRuntime, TScopeDomain, TFinalOutput>

export function defineReactor<
  const TKey extends string,
  TContextSchema extends z.ZodType,
  TEnv = EmptyReactorEnv,
  TRuntime extends ContextRuntimeServiceHandle = ContextRuntimeServiceHandle,
  TScopeDomain extends ReactorScopeDomain | undefined = undefined,
  TOutputSchema extends z.ZodType | undefined = undefined,
>(
  config: ReactorConfigWithContext<
    TKey,
    TContextSchema,
    TEnv,
    TRuntime,
    TScopeDomain,
    TOutputSchema
  >,
): ReactorFactory<
  ContextFromSchema<TContextSchema>,
  TEnv,
  TRuntime,
  TScopeDomain,
  OutputFromSchema<TOutputSchema>
>

export function defineReactor<
  const TKey extends string,
  TEnv = EmptyReactorEnv,
  TRuntime extends ContextRuntimeServiceHandle = ContextRuntimeServiceHandle,
  TScopeDomain extends ReactorScopeDomain | undefined = undefined,
  TOutputSchema extends z.ZodType | undefined = undefined,
>(
  config: ReactorConfigWithoutContext<
    TKey,
    TEnv,
    TRuntime,
    TScopeDomain,
    TOutputSchema
  >,
): ReactorFactory<
  EmptyReactorContext,
  TEnv,
  TRuntime,
  TScopeDomain,
  OutputFromSchema<TOutputSchema>
>

export function defineReactor(config: any): any {
  return (runtime: ContextRuntimeServiceHandle) =>
    new DefinedReactor(config, runtime)
}

async function resolveContextHandle<TContext>(params: {
  runtime: ContextRuntimeServiceHandle
  contextRef: ReactorContextRef
  reactorKey: string
  content: TContext
}): Promise<ContextHandle<TContext>> {
  if (params.contextRef instanceof ContextHandle) {
    return await (params.contextRef as ContextHandle<TContext>).updateContent(params.content)
  }

  const identifier =
    params.contextRef ??
    ({ key: `${params.reactorKey}:${randomUUID()}` } satisfies ContextIdentifier)

  return await ContextHandle.create<TContext>(params.runtime, {
    ...identifier,
    content: params.content,
    reactor: {
      kind: params.reactorKey,
    },
  })
}

async function resolveReactorRuntimeScope<TScopeDomain, TRuntime>(
  scope: TScopeDomain | undefined,
  runtime: TRuntime,
): Promise<ReactorRuntimeScope<TScopeDomain, TRuntime>> {
  if (!scope) return undefined as ReactorRuntimeScope<TScopeDomain, TRuntime>
  return await (scope as unknown as ReactorScopeDomain)(runtime) as ReactorRuntimeScope<TScopeDomain, TRuntime>
}

function createReadOnlyScope(scope: unknown): ReactorReadOnlyScope {
  if (!scope || typeof scope !== "object") return {}
  const source = scope as Record<string, unknown>
  const db = source.db && typeof source.db === "object"
    ? source.db as Record<string, unknown>
    : undefined

  return {
    domain: source.domain,
    schema: source.schema,
    context: source.context,
    contextString: source.contextString,
    env: source.env,
    query: source.query,
    db: db ? { query: db.query } : undefined,
  }
}

function parseInitialContext<TContext>(
  schema: z.ZodType<TContext> | undefined,
  content: TContext | undefined,
): TContext {
  if (schema) {
    return schema.parse(content)
  }
  return (content ?? {}) as TContext
}

function normalizeStepKey(key: string) {
  const normalized = key.trim()
  if (!normalized) throw new Error("Reactor step key is required.")
  return normalized
}

function normalizeInstructions(instructions: string, stepKey: string) {
  const normalized = instructions.trim()
  if (!normalized) {
    throw new Error(`Reactor step "${stepKey}" requires instructions.`)
  }
  return normalized
}

function buildStepParts(input: {
  key: string
  instructions: string
  payload?: unknown
  actions: string[]
  output?: unknown
  error?: unknown
  extraParts?: ContextPartEnvelope[]
}) {
  const parts: ContextPartEnvelope[] = [
    Part.json({
      kind: "reactor.step",
      key: input.key,
      instructions: input.instructions,
      payload: input.payload,
      actions: input.actions,
    }),
  ]

  if (input.output !== undefined) {
    parts.push(
      Part.json({
        kind: "reactor.step.output",
        key: input.key,
        output: input.output,
      }),
    )
  }

  if (input.error !== undefined) {
    parts.push(
      Part.json({
        kind: "reactor.step.error",
        key: input.key,
        error: serializeError(input.error),
      }),
    )
  }

  if (input.extraParts?.length) {
    parts.push(...input.extraParts)
  }

  return parts
}

function normalizeCompleteInput<TOutput>(
  input: ReactorCompleteInput<TOutput> | ReactorStepResult<TOutput>,
): ReactorCompleteInput<TOutput> {
  if (isStepResult(input)) {
    return {
      step: input,
      output: input.output,
    }
  }

  const step = input.step
  return {
    ...input,
    output: input.output ?? step?.output,
  }
}

function isStepResult(value: unknown): value is ReactorStepResult<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as ReactorStepResult).id === "string" &&
      typeof (value as ReactorStepResult).key === "string" &&
      "output" in value,
  )
}

function deepReadonly<T>(value: T): Readonly<T> {
  return value as Readonly<T>
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return error
}

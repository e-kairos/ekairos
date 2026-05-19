import type { DomainSchemaResult } from "@ekairos/domain"

import type { ContextEnvironment } from "./context.config.js"
import {
  ContextEngine,
  type ContextOptions,
  type ContextReactParams,
  type ContextReactResult,
  type ContextExecutionHandler,
  type ContextDirectRun,
} from "./context.engine.js"
import type {
  ContextRuntime,
  ContextRuntimeHandleForDomain,
} from "./context.runtime.js"
import type { ContextReactor } from "./context.reactor.js"
import type { ContextItem, StoredContext } from "./context.store.js"
import { registerContext, type ContextKey } from "./context.registry.js"
import { eventsDomain } from "./schema.js"

export interface ContextConfig<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> {
  context: (
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ) => Promise<Context> | Context
  expandEvents?: (
    events: ContextItem[],
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ) => Promise<ContextItem[]> | ContextItem[]
  reactor: ContextReactor<Context, Env, RequiredDomain>
  opts?: ContextOptions<Context, Env, RequiredDomain>
}

export type ContextInstance<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
> = ContextEngine<Context, Env, RequiredDomain> & {
  readonly __config: ContextConfig<Context, Env, RequiredDomain>
  readonly __contextKey?: ContextKey
  readonly __contextDomain?: RequiredDomain
}

export function context<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
>(config: ContextConfig<Context, Env, RequiredDomain>): ContextInstance<Context, Env, RequiredDomain> {
  class FunctionalContext extends ContextEngine<Context, Env, RequiredDomain> {
    public readonly __config = config

    constructor() {
      super(config.opts, config.reactor)
    }

    protected async initialize(
      contextValue: StoredContext<Context>,
      env: Env,
      runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      return config.context(contextValue, env, runtime)
    }

    protected async expandEvents(
      events: ContextItem[],
      contextValue: StoredContext<Context>,
      env: Env,
      runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      if (config.expandEvents) return config.expandEvents(events, contextValue, env, runtime)
      return super.expandEvents(events, contextValue, env, runtime)
    }

    protected async buildSystemPrompt(
      _contextValue: StoredContext<Context>,
      _env: Env,
      _runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      return ""
    }

    protected async buildSkills(
      _contextValue: StoredContext<Context>,
      _env: Env,
      _runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      return []
    }

    protected async buildTools(
      _contextValue: StoredContext<Context>,
      _env: Env,
      _runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      return {}
    }
  }

  const instance = new FunctionalContext()
  return Object.assign(instance, { __config: config })
}

type AnyContextInitializer<
  Env extends ContextEnvironment,
  RequiredDomain extends DomainSchemaResult,
> = (
  context: StoredContext<any>,
  env: Env,
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
) => Promise<any> | any

type InferContextFromInitializer<I extends AnyContextInitializer<any, any>> = Awaited<
  ReturnType<I>
>

type BuilderExpandEvents<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainSchemaResult,
> = (
  events: ContextItem[],
  context: StoredContext<Context>,
  env: Env,
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
) => Promise<ContextItem[]> | ContextItem[]

export type RegistrableContextBuilder = {
  key: ContextKey
  register: () => void
}

type FluentContextBuilder<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainSchemaResult,
> = {
  key: ContextKey
  expandEvents(fn: BuilderExpandEvents<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  reactor(reactor: ContextReactor<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  opts(opts: ContextOptions<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  react<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
    handler: ContextExecutionHandler<Context, Env, RequiredDomain>,
  ): Promise<ContextReactResult<Context, ContextDirectRun<Context>>>
  register(): void
  config(): ContextConfig<Context, Env, RequiredDomain>
  build(): ContextInstance<Context, Env, RequiredDomain>
}

type CreateContextEntry<
  Env extends ContextEnvironment,
  RequiredDomain extends DomainSchemaResult,
> = {
  context<Initializer extends AnyContextInitializer<Env, RequiredDomain>>(
    initializer: Initializer,
  ): FluentContextBuilder<InferContextFromInitializer<Initializer>, Env, RequiredDomain>
  initialize<Initializer extends AnyContextInitializer<Env, RequiredDomain>>(
    initializer: Initializer,
  ): FluentContextBuilder<InferContextFromInitializer<Initializer>, Env, RequiredDomain>
}

function assertConfigComplete<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainSchemaResult,
>(
  config: Partial<ContextConfig<Context, Env, RequiredDomain>>,
): asserts config is ContextConfig<Context, Env, RequiredDomain> {
  if (!config.context) {
    throw new Error("createContext: you must define context() before building the Context.")
  }
  if (!config.reactor) {
    throw new Error("createContext: you must define reactor() before building the Context.")
  }
}

export function createContext<
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = DomainSchemaResult,
>(
  domain: RequiredDomain,
  key: ContextKey,
): CreateContextEntry<Env, RequiredDomain>

export function createContext<Env extends ContextEnvironment = ContextEnvironment>(
  key: ContextKey,
): CreateContextEntry<Env, typeof eventsDomain>

export function createContext<
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
>(
  keyOrDomain: ContextKey | RequiredDomain,
  maybeKey?: ContextKey,
): CreateContextEntry<Env, RequiredDomain> {
  const requiredDomain =
    typeof keyOrDomain === "string" ? eventsDomain : keyOrDomain
  const key =
    typeof keyOrDomain === "string" ? keyOrDomain : maybeKey
  if (!key) {
    throw new Error("createContext: key is required.")
  }

  const initializeBuilder = <Initializer extends AnyContextInitializer<Env, RequiredDomain>>(
    initializer: Initializer,
  ) => {
    type Context = InferContextFromInitializer<Initializer>

    const typedInitializer: ContextConfig<Context, Env, RequiredDomain>["context"] = (ctx, env, runtime) =>
      initializer(ctx as StoredContext<Context>, env, runtime)

    const fluentState: Partial<ContextConfig<Context, Env, RequiredDomain>> = {
      context: typedInitializer,
    }

    let cached: ContextInstance<Context, Env, RequiredDomain> | null = null

    const getOrBuild = () => {
      assertConfigComplete(fluentState)
      if (!cached) {
        const config = fluentState as ContextConfig<Context, Env, RequiredDomain>
        cached = Object.assign(context(config), {
          __contextKey: key,
          __contextDomain: requiredDomain as RequiredDomain,
        })
        registerContext(key, () => cached as ContextInstance<Context, Env, RequiredDomain>)
      }
      return cached
    }

    const builder: FluentContextBuilder<Context, Env, RequiredDomain> = {
      key,
      expandEvents(fn) {
        fluentState.expandEvents = fn
        return builder
      },
      reactor(reactor) {
        fluentState.reactor = reactor
        return builder
      },
      opts(options) {
        fluentState.opts = options
        return builder
      },
      react: ((
        triggerEvent: ContextItem,
        params: ContextReactParams<Env, RequiredDomain>,
        handler: ContextExecutionHandler<Context, Env, RequiredDomain>,
      ) =>
        getOrBuild().react(triggerEvent, params as any, handler as any)) as FluentContextBuilder<
        Context,
        Env,
        RequiredDomain
      >["react"],
      register() {
        getOrBuild()
      },
      config() {
        assertConfigComplete(fluentState)
        return fluentState
      },
      build() {
        return getOrBuild()
      },
    }

    return builder
  }

  return {
    context: initializeBuilder,
    initialize: initializeBuilder,
  }
}

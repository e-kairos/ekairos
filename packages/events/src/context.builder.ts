import type { DomainLike } from "@ekairos/domain"

import type { ContextEnvironment } from "./context.config.js"
import type { ContextSkillPackage } from "./context.skill.js"
import {
  ContextEngine,
  type ContextModelInit,
  type ContextOptions,
  type ShouldContinue,
  type ContextShouldContinueArgs,
  type ContextReactParams,
  type ContextDirectReactParams,
  type ContextDurableReactParams,
  type ContextReactResult,
  type ContextDirectRun,
  type ContextWorkflowRun,
} from "./context.engine.js"
import type { ContextTool } from "./context.action.js"
import type {
  ContextRuntime,
  ContextRuntimeHandleForDomain,
} from "./context.runtime.js"
import type { ContextReactor } from "./context.reactor.js"
import type {
  ContextItem,
  ContextResource,
  StoredContext,
  StoredContextResource,
} from "./context.store.js"
import { registerContext, type ContextKey } from "./context.registry.js"
import { eventsDomain } from "./schema.js"

export type ContextResourcesParams<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainLike = typeof eventsDomain,
> = {
  content: Context
  context: StoredContext<Context>
  env: Env
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>
}

export interface ContextConfig<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainLike = typeof eventsDomain,
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
  narrative?: (
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ) => Promise<string> | string
  description?: (
    content: Context,
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ) => Promise<string> | string
  goal?: (
    content: Context,
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ) => Promise<string> | string
  resources?: (
    params: ContextResourcesParams<Context, Env, RequiredDomain>,
  ) =>
    | Promise<ContextResource[] | StoredContextResource[]>
    | ContextResource[]
    | StoredContextResource[]
  skills?: (
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ) => Promise<ContextSkillPackage[]> | ContextSkillPackage[]
  actions: (
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ) =>
    | Promise<Record<string, ContextTool<Context, Env, RequiredDomain>>>
    | Record<string, ContextTool<Context, Env, RequiredDomain>>
  /**
   * @deprecated Use `actions()` instead.
   */
  tools?: (
    context: StoredContext<Context>,
    env: Env,
    runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
  ) =>
    | Promise<Record<string, ContextTool<Context, Env, RequiredDomain>>>
    | Record<string, ContextTool<Context, Env, RequiredDomain>>
  model?:
    | ContextModelInit
    | ((
        context: StoredContext<Context>,
        env: Env,
        runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
      ) => ContextModelInit)
  reactor?: ContextReactor<Context, Env, RequiredDomain>
  shouldContinue?: (
    args: ContextShouldContinueArgs<Context, Env, RequiredDomain>,
  ) => Promise<ShouldContinue> | ShouldContinue
  opts?: ContextOptions<Context, Env, RequiredDomain>
}

export type ContextInstance<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainLike = typeof eventsDomain,
> = ContextEngine<Context, Env, RequiredDomain> & {
  readonly __config: ContextConfig<Context, Env, RequiredDomain>
  readonly __contextKey?: ContextKey
  readonly __contextDomain?: RequiredDomain
}

function isDynamicModelSelector<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
>(
  model: ContextConfig<Context, Env, RequiredDomain>["model"],
): model is (
  context: StoredContext<Context>,
  env: Env,
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
) => ContextModelInit {
  return typeof model === "function" && model.length >= 1
}

function stringifyContextContent(content: unknown) {
  try {
    return JSON.stringify(content ?? null, null, 2)
  } catch {
    return String(content)
  }
}

function buildDefaultContextPrompt(params: {
  content: unknown
  resources?: StoredContextResource[] | null
  description?: string | null
  goal?: string | null
}) {
  const sections: string[] = []
  sections.push(`Content:\n${stringifyContextContent(params.content)}`)
  if (params.resources?.length) {
    sections.push(`Resources:\n${stringifyContextContent(params.resources)}`)
  }
  if (params.description) {
    sections.push(`Description:\n${params.description}`)
  }
  if (params.goal) {
    sections.push(`Goal:\n${params.goal}`)
  }
  return sections.join("\n\n")
}

export function context<
  Context,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainLike = typeof eventsDomain,
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
      contextValue: StoredContext<Context>,
      env: Env,
      runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      if (config.narrative) return config.narrative(contextValue, env, runtime)
      const content = contextValue.content as Context
      const description =
        contextValue.description ??
        (config.description
          ? await config.description(content, contextValue, env, runtime)
          : null)
      const goal =
        contextValue.goal ??
        (config.goal
          ? await config.goal(content, contextValue, env, runtime)
          : null)
      return buildDefaultContextPrompt({
        content,
        resources: contextValue.resources ?? [],
        description,
        goal,
      })
    }

    protected async describeContext(
      content: Context,
      contextValue: StoredContext<Context>,
      env: Env,
      runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      if (!config.description) return null
      return config.description(content, contextValue, env, runtime)
    }

    protected async defineGoal(
      content: Context,
      contextValue: StoredContext<Context>,
      env: Env,
      runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      if (!config.goal) return null
      return config.goal(content, contextValue, env, runtime)
    }

    protected async defineResources(
      content: Context,
      contextValue: StoredContext<Context>,
      env: Env,
      runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      if (!config.resources) return []
      return config.resources({ content, context: contextValue, env, runtime })
    }

    protected async buildSkills(
      contextValue: StoredContext<Context>,
      env: Env,
      runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      if (config.skills) return config.skills(contextValue, env, runtime)
      return []
    }

    protected async buildTools(
      contextValue: StoredContext<Context>,
      env: Env,
      runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      if (config.actions) return config.actions(contextValue, env, runtime)
      if (config.tools) return config.tools(contextValue, env, runtime)
      throw new Error("Context config is missing actions()")
    }

    protected getModel(
      contextValue: StoredContext<Context>,
      env: Env,
      runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) {
      if (isDynamicModelSelector(config.model)) return config.model(contextValue, env, runtime)
      return config.model ?? super.getModel(contextValue, env, runtime)
    }

    protected async shouldContinue(
      args: ContextShouldContinueArgs<Context, Env, RequiredDomain>,
    ) {
      if (config.shouldContinue) return config.shouldContinue(args)
      return true
    }
  }

  const instance = new FunctionalContext()
  return Object.assign(instance, { __config: config })
}

type AnyContextInitializer<
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> = (
  context: StoredContext<any>,
  env: Env,
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
) => Promise<any> | any

type InferContextFromInitializer<I extends AnyContextInitializer<any, any>> = Awaited<
  ReturnType<I>
>

type BuilderSystemPrompt<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> = (
  context: StoredContext<Context>,
  env: Env,
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
) => Promise<string> | string

type BuilderDescription<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> = (
  content: Context,
  context: StoredContext<Context>,
  env: Env,
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
) => Promise<string> | string

type BuilderGoal<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> = BuilderDescription<Context, Env, RequiredDomain>

type BuilderResources<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> = (
  params: ContextResourcesParams<Context, Env, RequiredDomain>,
) =>
  | Promise<ContextResource[] | StoredContextResource[] | null>
  | ContextResource[]
  | StoredContextResource[]
  | null

type BuilderResource<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> =
  | ContextResource
  | StoredContextResource
  | ((
      params: ContextResourcesParams<Context, Env, RequiredDomain>,
    ) =>
      | Promise<ContextResource | StoredContextResource | null | undefined>
      | ContextResource
      | StoredContextResource
      | null
      | undefined)

type BuilderSkills<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> = (
  context: StoredContext<Context>,
  env: Env,
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
) => Promise<ContextSkillPackage[]> | ContextSkillPackage[]

type BuilderTools<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> = (
  context: StoredContext<Context>,
  env: Env,
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
) =>
  | Promise<Record<string, ContextTool<Context, Env, RequiredDomain>>>
  | Record<string, ContextTool<Context, Env, RequiredDomain>>

type BuilderExpandEvents<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> = (
  events: ContextItem[],
  context: StoredContext<Context>,
  env: Env,
  runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
) => Promise<ContextItem[]> | ContextItem[]

type BuilderShouldContinue<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> = (
  args: ContextShouldContinueArgs<Context, Env, RequiredDomain>,
) => Promise<ShouldContinue> | ShouldContinue

type BuilderModel<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> =
  | ContextModelInit
  | ((
      context: StoredContext<Context>,
      env: Env,
      runtime: ContextRuntimeHandleForDomain<Env, RequiredDomain>,
    ) => ContextModelInit)

export type RegistrableContextBuilder = {
  key: ContextKey
  register: () => void
}

type FluentContextBuilder<
  Context,
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> = {
  key: ContextKey
  expandEvents(fn: BuilderExpandEvents<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  narrative(fn: BuilderSystemPrompt<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  system(fn: BuilderSystemPrompt<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  description(fn: BuilderDescription<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  goal(fn: BuilderGoal<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  resources(fn: BuilderResources<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  resource(resource: BuilderResource<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  skills(fn: BuilderSkills<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  actions(fn: BuilderTools<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  tools(fn: BuilderTools<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  model(model: BuilderModel<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  reactor(reactor: ContextReactor<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  shouldContinue(fn: BuilderShouldContinue<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  opts(opts: ContextOptions<Context, Env, RequiredDomain>): FluentContextBuilder<Context, Env, RequiredDomain>
  react<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextDurableReactParams<Env, RequiredDomain, Runtime>,
  ): Promise<ContextReactResult<Context, ContextWorkflowRun<Context>>>
  react<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextDirectReactParams<Env, RequiredDomain, Runtime>,
  ): Promise<ContextReactResult<Context, ContextDirectRun<Context>>>
  react<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
  ): ReturnType<
    ContextEngine<Context, Env, RequiredDomain>["react"]
  >
  stream<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextDurableReactParams<Env, RequiredDomain, Runtime>,
  ): Promise<ContextReactResult<Context, ContextWorkflowRun<Context>>>
  stream<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextDirectReactParams<Env, RequiredDomain, Runtime>,
  ): Promise<ContextReactResult<Context, ContextDirectRun<Context>>>
  stream<Runtime extends ContextRuntime<Env>>(
    triggerEvent: ContextItem,
    params: ContextReactParams<Env, RequiredDomain, Runtime>,
  ): ReturnType<ContextEngine<Context, Env, RequiredDomain>["react"]>
  register(): void
  config(): ContextConfig<Context, Env, RequiredDomain>
  build(): ContextInstance<Context, Env, RequiredDomain>
}

type CreateContextEntry<
  Env extends ContextEnvironment,
  RequiredDomain extends DomainLike,
> = {
  content<Initializer extends AnyContextInitializer<Env, RequiredDomain>>(
    initializer: Initializer,
  ): FluentContextBuilder<InferContextFromInitializer<Initializer>, Env, RequiredDomain>
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
  RequiredDomain extends DomainLike,
>(
  config: Partial<ContextConfig<Context, Env, RequiredDomain>>,
): asserts config is ContextConfig<Context, Env, RequiredDomain> {
  if (!config.context) {
    throw new Error("createContext: you must define content() before building the Context.")
  }
  if (!config.narrative && (!config.description || !config.goal)) {
    throw new Error("createContext: you must define description() and goal() before building the Context.")
  }
  if (!config.actions && !config.tools) {
    throw new Error("createContext: you must define actions() before building the Context.")
  }
}

export function createContext<
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainLike = DomainLike,
>(
  domain: RequiredDomain,
  key: ContextKey,
): CreateContextEntry<Env, RequiredDomain>

export function createContext<Env extends ContextEnvironment = ContextEnvironment>(
  key: ContextKey,
): CreateContextEntry<Env, typeof eventsDomain>

export function createContext<
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainLike = typeof eventsDomain,
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

    const resourceFactories: BuilderResources<Context, Env, RequiredDomain>[] = []

    const refreshResourcesConfig = () => {
      fluentState.resources = async (params) => {
        const resources: StoredContextResource[] = []
        for (const factory of resourceFactories) {
          const result = await factory(params)
          if (!result) continue
          const list = Array.isArray(result) ? result : [result]
          resources.push(...(list as StoredContextResource[]))
        }
        return resources
      }
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
      narrative(narrative) {
        fluentState.narrative = narrative
        return builder
      },
      system(system) {
        fluentState.narrative = system
        return builder
      },
      description(description) {
        fluentState.description = description
        return builder
      },
      goal(goal) {
        fluentState.goal = goal
        return builder
      },
      resources(resources) {
        resourceFactories.push(resources)
        refreshResourcesConfig()
        return builder
      },
      resource(resource) {
        resourceFactories.push(async (params) => {
          if (typeof resource === "function") {
            const resolved = await resource(params)
            return resolved ? [resolved] : []
          }
          return [resource]
        })
        refreshResourcesConfig()
        return builder
      },
      skills(skillsFactory) {
        fluentState.skills = skillsFactory
        return builder
      },
      actions(actionsFactory) {
        fluentState.actions = actionsFactory
        return builder
      },
      tools(toolsFactory) {
        fluentState.actions = toolsFactory
        return builder
      },
      model(model) {
        fluentState.model = model as any
        return builder
      },
      reactor(reactor) {
        fluentState.reactor = reactor
        return builder
      },
      shouldContinue(fn) {
        fluentState.shouldContinue = fn as any
        return builder
      },
      opts(options) {
        fluentState.opts = options
        return builder
      },
      react: ((triggerEvent: ContextItem, params: ContextReactParams<Env, RequiredDomain>) =>
        getOrBuild().react(triggerEvent, params as any)) as FluentContextBuilder<
        Context,
        Env,
        RequiredDomain
      >["react"],
      stream: ((triggerEvent: ContextItem, params: ContextReactParams<Env, RequiredDomain>) =>
        builder.react(triggerEvent, params as any)) as FluentContextBuilder<
        Context,
        Env,
        RequiredDomain
      >["stream"],
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
    content: initializeBuilder,
    context: initializeBuilder,
    initialize: initializeBuilder,
  }
}

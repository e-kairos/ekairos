import type { LanguageModel } from "ai"
import { generateObject } from "ai"
import type { z } from "zod"

import {
  defineEvent,
  type DomainEventCollection,
  type DomainEventCreateOptions,
  type DomainEventDefinition,
  type DomainEventMethods,
  type DomainEventRecord,
  type DomainEventRegistration,
  type DomainEventsOf,
  type DomainLike,
} from "@ekairos/domain"
import {
  ContextHandle,
  Events,
  Part,
  contextDomain,
  eventsDomain,
  reactionDomain,
  type ContextHandleCreateParams,
  type ContextIdentifier,
  type ContextItem,
  type ContextRuntimeServiceHandle,
} from "@ekairos/events"
import {
  defineReactor,
  type ReactorEngine,
  type ReactorEngineStepInput,
  type ReactorFactory,
  type ReactorReactRuntimeOptions,
  type ReactorSandboxFactoryInput,
  type ReactorSandboxInput,
  type ReactorSandboxProvider,
} from "@ekairos/reactor"

export {
  ContextHandle,
  Events,
  Part,
  contextDomain,
  defineEvent,
  eventsDomain,
  reactionDomain,
}

export type {
  ContextHandleCreateParams,
  ContextIdentifier,
  ContextItem,
  ContextRuntimeServiceHandle,
  DomainEventCollection,
  DomainEventCreateOptions,
  DomainEventDefinition,
  DomainEventMethods,
  DomainEventRecord,
  DomainEventRegistration,
  DomainEventsOf,
}

export {
  defineReactor,
  defineReactor as defineReaction,
}

export type {
  ReactorEngine as ContextReactionEngine,
  ReactorEngineStepInput as ContextReactionEngineStepInput,
  ReactorFactory as ContextReactionFactory,
  ReactorReactRuntimeOptions as ContextReactionRuntimeOptions,
  ReactorSandboxFactoryInput as ContextReactionSandboxFactoryInput,
  ReactorSandboxInput as ContextReactionSandboxInput,
  ReactorSandboxProvider as ContextReactionSandboxProvider,
}

type CallableDomainFor<Runtime> = DomainLike & {
  (runtime: Runtime, options?: unknown): Promise<unknown>
}

export type ContextClient<Runtime extends ContextRuntimeServiceHandle> = {
  create<Context = unknown>(
    params: ContextHandleCreateParams<Context>,
  ): Promise<ContextHandle<Context>>
  get<Context = unknown>(
    identifier: ContextIdentifier,
  ): Promise<ContextHandle<Context> | null>
  events: ReturnType<typeof Events>
  use<Domain extends CallableDomainFor<Runtime>>(
    domain: Domain,
    options?: unknown,
  ): Promise<Awaited<ReturnType<Domain>>>
}

export function Context<Runtime extends ContextRuntimeServiceHandle>(
  runtime: Runtime,
): ContextClient<Runtime> {
  return {
    async create<Context = unknown>(params: ContextHandleCreateParams<Context>) {
      return await ContextHandle.create(runtime, params)
    },
    async get<Context = unknown>(identifier: ContextIdentifier) {
      return await ContextHandle.get<Context>(runtime, identifier)
    },
    events: Events(runtime),
    async use<Domain extends CallableDomainFor<Runtime>>(
      domain: Domain,
      options?: unknown,
    ): Promise<Awaited<ReturnType<Domain>>> {
      if (typeof domain !== "function") {
        throw new Error("Context(runtime).use(domain) requires a callable domain.")
      }
      const scoped = await domain(runtime, options)
      return scoped as Awaited<ReturnType<Domain>>
    },
  }
}

export type AiSdkStepEngineOptions<TContext = unknown, TEnv = unknown> = {
  model:
    | LanguageModel
    | ((input: ReactorEngineStepInput<TContext, TEnv, unknown, any>) =>
        | LanguageModel
        | Promise<LanguageModel>)
  system?:
    | string
    | ((input: ReactorEngineStepInput<TContext, TEnv, unknown, any>) =>
        | string
        | Promise<string>)
}

export function createAiSdkStepEngine<TContext = unknown, TEnv = unknown>(
  options: AiSdkStepEngineOptions<TContext, TEnv>,
): ReactorEngine<TContext, TEnv> {
  return {
    async step<TOutput, TActions extends Record<string, (...args: any[]) => unknown>>(
      input: ReactorEngineStepInput<TContext, TEnv, TOutput, TActions>,
    ): Promise<TOutput | unknown> {
      if (!input.step.output) return undefined

      const model =
        typeof options.model === "function"
          ? await options.model(input)
          : options.model
      const system =
        typeof options.system === "function"
          ? await options.system(input)
          : options.system

      const prompt = buildStepPrompt(input)
      const result = await generateObject({
        model,
        ...(system ? { system } : {}),
        prompt,
        schema: input.step.output as z.ZodType<TOutput>,
      })

      return result.object
    },
  }
}

function buildStepPrompt<TContext, TEnv, TOutput, TActions extends Record<string, (...args: any[]) => unknown>>(
  input: ReactorEngineStepInput<TContext, TEnv, TOutput, TActions>,
) {
  const sections: string[] = [
    `Reaction: ${input.reactorKey}`,
    `Step: ${input.step.key}`,
    "",
    "Instructions:",
    input.step.instructions,
  ]

  if (input.context?.content && Object.keys(input.context.content as Record<string, unknown>).length > 0) {
    sections.push("", "Initial context:", JSON.stringify(input.context.content, null, 2))
  }

  if (input.triggerEvent) {
    sections.push("", "Trigger event:", JSON.stringify(input.triggerEvent, null, 2))
  }

  if (input.step.payload !== undefined) {
    sections.push("", "Step payload:", JSON.stringify(input.step.payload, null, 2))
  }

  const actionNames = Object.keys(input.actions ?? {})
  if (actionNames.length > 0) {
    sections.push(
      "",
      "Available explicit actions:",
      actionNames.map((name) => `- ${name}`).join("\n"),
    )
  }

  return sections.join("\n")
}

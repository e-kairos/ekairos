import {
  defineEvent,
  type DomainEventCollection,
  type DomainEventConstructor,
  type DomainEventConstructorDefinition,
  type DomainEventDefinition,
  type DomainEventDraft,
  type DomainEventLinkDefinition,
  type DomainEventLinkParams,
  type DomainEventMethods,
  type DomainEventPhysicalLink,
  type DomainEventRegistration,
  type DomainEventsOf,
  type DomainLike,
} from "@ekairos/domain"
import {
  ContextHandle,
  Events,
  Part,
  contextDomain,
  type ContextEvent,
  type ContextRuntimeServiceHandle,
  type DomainEventEnvelope,
  type DomainEventItem,
} from "@ekairos/events"
import {
  Session,
  type AnyReactionEngine,
  type ReactionSandbox,
} from "@ekairos/reactor"

export {
  ContextHandle,
  Events,
  Part,
  Session,
  contextDomain,
  defineEvent,
}
export type {
  ContextEvent,
  ContextRuntimeServiceHandle,
  DomainEventCollection,
  DomainEventConstructor,
  DomainEventConstructorDefinition,
  DomainEventDefinition,
  DomainEventDraft,
  DomainEventEnvelope,
  DomainEventItem,
  DomainEventLinkDefinition,
  DomainEventLinkParams,
  DomainEventMethods,
  DomainEventPhysicalLink,
  DomainEventRegistration,
  DomainEventsOf,
}

export type ContextRuntimeWithDomainUse = ContextRuntimeServiceHandle & {
  use(domain: DomainLike, options?: unknown): Promise<unknown>
  env?: unknown
  materializeDataset?: unknown
}

export type ContextSessionOptions<ContextContent> = Readonly<{
  sandbox?: ReactionSandbox<ContextContent> | false
}>

export type ContextClient<Runtime extends ContextRuntimeWithDomainUse> = Readonly<{
  open(contextKey: string): Promise<ContextHandle<unknown>>
  session<
    Scope extends DomainLike,
    ContextContent = unknown,
  >(
    contextKey: string,
    scope: Scope,
    engine: AnyReactionEngine<ContextContent> | false,
    options?: ContextSessionOptions<ContextContent>,
  ): Promise<Session<ContextContent, Scope>>
}>

export function Context<Runtime extends ContextRuntimeWithDomainUse>(
  runtime: Runtime,
): ContextClient<Runtime> {
  return Object.freeze({
    async open(contextKey: string) {
      return await ContextHandle.open(runtime, { key: contextKey })
    },
    async session<
      Scope extends DomainLike,
      ContextContent = unknown,
    >(
      contextKey: string,
      scope: Scope,
      engine: AnyReactionEngine<ContextContent> | false,
      options: ContextSessionOptions<ContextContent> = {},
    ) {
      const context = await ContextHandle.open<ContextContent>(runtime, {
        key: contextKey,
      })
      return new Session(runtime as any, context, {
        scope,
        engine,
        sandbox: options.sandbox ?? false,
      })
    },
  })
}

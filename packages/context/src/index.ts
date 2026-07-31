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
  type ContextHandleOpenParams,
  type ContextRuntimeServiceHandle,
  type DomainEventEnvelope,
  type DomainEventItem,
  type StoredContext,
} from "@ekairos/events"
import {
  Session,
  type SessionConfig,
} from "@ekairos/reactor"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

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
  ContextHandleOpenParams,
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
  SessionConfig,
}

export type ContextRuntimeWithDomainUse = ContextRuntimeServiceHandle & {
  use(domain: DomainLike, options?: unknown): Promise<unknown>
  env?: unknown
  materializeDataset?: unknown
}

export class SessionContextHandle<
  ContextContent = unknown,
  Runtime extends ContextRuntimeWithDomainUse = ContextRuntimeWithDomainUse,
> extends ContextHandle<ContextContent> {
  declare readonly runtime: Runtime

  constructor(runtime: Runtime, context: StoredContext<ContextContent>) {
    super(runtime, context)
  }

  static [WORKFLOW_SERIALIZE](instance: SessionContextHandle<unknown, any>) {
    return {
      runtime: instance.runtime,
      context: instance.context,
    }
  }

  static [WORKFLOW_DESERIALIZE](data: {
    runtime: ContextRuntimeWithDomainUse
    context: StoredContext<unknown>
  }) {
    return new SessionContextHandle(data.runtime, data.context)
  }

  session<Scope extends DomainLike>(
    config: SessionConfig<ContextContent, Scope>,
  ): Session<ContextContent, Scope> {
    return new Session(this.runtime as any, this, config)
  }
}

export type ContextClient<Runtime extends ContextRuntimeWithDomainUse> = Readonly<{
  open<ContextContent = unknown>(
    params: ContextHandleOpenParams<ContextContent>,
  ): Promise<SessionContextHandle<ContextContent, Runtime>>
}>

export function Context<Runtime extends ContextRuntimeWithDomainUse>(
  runtime: Runtime,
): ContextClient<Runtime> {
  return Object.freeze({
    async open<ContextContent = unknown>(
      params: ContextHandleOpenParams<ContextContent>,
    ) {
      const handle = await ContextHandle.open(runtime, params)
      return new SessionContextHandle<ContextContent, Runtime>(
        runtime,
        handle.context as StoredContext<ContextContent>,
      )
    },
  })
}

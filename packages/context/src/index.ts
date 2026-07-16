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
  type MaterializedDomainLike,
} from "@ekairos/domain"
import {
  ContextHandle,
  Events,
  Part,
  contextDomain,
  type ContextEvent,
  type ContextHandleCreateParams,
  type ContextIdentifier,
  type ContextRuntimeServiceHandle,
  type DomainEventEnvelope,
  type DomainEventItem,
  type StoredContext,
} from "@ekairos/events"
import type {
  ReactOptions,
  ReactionDefinition,
  ReactionEffect,
} from "@ekairos/reactor"
import { executeReaction } from "@ekairos/reactor/internal"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

export {
  ContextHandle,
  Events,
  Part,
  contextDomain,
  defineEvent,
}
export type {
  ContextEvent,
  ContextHandleCreateParams,
  ContextIdentifier,
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
  use<Domain extends MaterializedDomainLike>(
    domain: Domain,
    options?: unknown,
  ): Promise<unknown>
  env?: unknown
  materializeDataset?: unknown
}

export class ReactionContextHandle<
  ContextContent = unknown,
  Runtime extends ContextRuntimeWithDomainUse = ContextRuntimeWithDomainUse,
> extends ContextHandle<ContextContent> {
  declare readonly runtime: Runtime

  constructor(runtime: Runtime, context: StoredContext<ContextContent>) {
    super(runtime, context)
  }

  static [WORKFLOW_SERIALIZE](instance: ReactionContextHandle<unknown, any>) {
    return { runtime: instance.runtime, context: instance.context }
  }

  static [WORKFLOW_DESERIALIZE](data: {
    runtime: ContextRuntimeWithDomainUse
    context: StoredContext<unknown>
  }) {
    return new ReactionContextHandle(data.runtime, data.context)
  }

  async react<
    Scope extends DomainLike,
    Effect extends ReactionEffect,
  >(
    trigger: ContextEvent,
    definition: ReactionDefinition<ContextContent, Scope, any, Effect>,
    options?: ReactOptions,
  ): Promise<Effect> {
    return await executeReaction(this.runtime as any, this, trigger, definition, options)
  }

  override async refresh(): Promise<ReactionContextHandle<ContextContent, Runtime>> {
    const handle = await super.refresh()
    return new ReactionContextHandle(this.runtime, handle.context)
  }

  override async updateContent(
    content: ContextContent,
  ): Promise<ReactionContextHandle<ContextContent, Runtime>> {
    const handle = await super.updateContent(content)
    return new ReactionContextHandle(this.runtime, handle.context)
  }
}

export type ContextClient<Runtime extends ContextRuntimeWithDomainUse> = Readonly<{
  create<ContextContent = unknown>(
    params: ContextHandleCreateParams<ContextContent>,
  ): Promise<ReactionContextHandle<ContextContent, Runtime>>
  get<ContextContent = unknown>(
    identifier: ContextIdentifier,
  ): Promise<ReactionContextHandle<ContextContent, Runtime> | null>
  events: ReturnType<typeof Events>
  use<Domain extends MaterializedDomainLike>(
    domain: Domain,
    options?: unknown,
  ): ReturnType<Runtime["use"]>
}>

export function Context<Runtime extends ContextRuntimeWithDomainUse>(
  runtime: Runtime,
): ContextClient<Runtime> {
  return Object.freeze({
    async create<ContextContent = unknown>(
      params: ContextHandleCreateParams<ContextContent>,
    ) {
      const handle = await ContextHandle.create(runtime, params)
      return new ReactionContextHandle(runtime, handle.context)
    },
    async get<ContextContent = unknown>(identifier: ContextIdentifier) {
      const handle = await ContextHandle.get<ContextContent>(runtime, identifier)
      return handle ? new ReactionContextHandle(runtime, handle.context) : null
    },
    events: Events(runtime),
    use<Domain extends MaterializedDomainLike>(
      domain: Domain,
      options?: unknown,
    ): ReturnType<Runtime["use"]> {
      return runtime.use(domain, options) as ReturnType<Runtime["use"]>
    },
  })
}

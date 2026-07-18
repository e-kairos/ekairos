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
  getContextRuntimeServices,
  uuidV5,
  type ContextEvent,
  type ContextHandleCreateParams,
  type ContextIdentifier,
  type ContextRuntimeServiceHandle,
  type DomainEventEnvelope,
  type DomainEventItem,
  type StoredContext,
} from "@ekairos/events"
import type {
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

const CONTEXT_REACTION_EVENT_NAMESPACE = "1b11fe82-87fb-46c8-a210-bc65c3788073"

type ReactionOrigin = Readonly<{
  sessionId: string
  reactionId: string
}>

export type ContextReactionEmitOptions = Readonly<
  Omit<DomainEventEnvelope, "id" | "contextId" | "metadata"> & {
    key: string
    metadata?: Readonly<Record<string, unknown>>
  }
>

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
  readonly origin?: ReactionOrigin

  constructor(
    runtime: Runtime,
    context: StoredContext<ContextContent>,
    origin?: ReactionOrigin,
  ) {
    super(runtime, context)
    this.origin = origin
  }

  static [WORKFLOW_SERIALIZE](instance: ReactionContextHandle<unknown, any>) {
    return {
      runtime: instance.runtime,
      context: instance.context,
      ...(instance.origin ? { origin: instance.origin } : {}),
    }
  }

  static [WORKFLOW_DESERIALIZE](data: {
    runtime: ContextRuntimeWithDomainUse
    context: StoredContext<unknown>
    origin?: ReactionOrigin
  }) {
    return new ReactionContextHandle(data.runtime, data.context, data.origin)
  }

  async emit<Payload>(
    draft: DomainEventDraft<Payload, any, any, any, any, any>,
    options: ContextReactionEmitOptions,
  ): Promise<DomainEventItem<Payload>> {
    if (!this.origin) throw new Error("context_reaction_origin_required")
    const key = options.key.trim()
    if (!key) throw new Error("context_reaction_event_key_required")
    const event = await Events(this.runtime).emit(draft, {
      id: uuidV5(
        `${this.origin.reactionId}:${key}`,
        CONTEXT_REACTION_EVENT_NAMESPACE,
      ),
      contextId: this.id,
      ...(options.channel ? { channel: options.channel } : {}),
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      ...(options.parts ? { parts: options.parts } : {}),
      metadata: {
        ...options.metadata,
        sessionId: this.origin.sessionId,
        reactionId: this.origin.reactionId,
      },
    })
    const { store } = await getContextRuntimeServices(this.runtime)
    await store.appendReactionEffect(this.origin.reactionId, event.id)
    return event
  }

  async react<
    Scope extends DomainLike,
    Effect extends ReactionEffect,
  >(
    trigger: ContextEvent,
    definition: ReactionDefinition<ContextContent, Scope, any, Effect>,
  ): Promise<Effect> {
    return await executeReaction(this.runtime as any, this, trigger, definition, {
      ...(this.origin
        ? {
            parentSessionId: this.origin.sessionId,
            parentReactionId: this.origin.reactionId,
          }
        : {}),
    })
  }

  override async refresh(): Promise<ReactionContextHandle<ContextContent, Runtime>> {
    const handle = await super.refresh()
    return new ReactionContextHandle(this.runtime, handle.context, this.origin)
  }

  override async updateContent(
    content: ContextContent,
  ): Promise<ReactionContextHandle<ContextContent, Runtime>> {
    const handle = await super.updateContent(content)
    return new ReactionContextHandle(this.runtime, handle.context, this.origin)
  }
}

export type ContextClient<Runtime extends ContextRuntimeWithDomainUse> = Readonly<{
  create<ContextContent = unknown>(
    params: ContextHandleCreateParams<ContextContent>,
  ): Promise<ReactionContextHandle<ContextContent, Runtime>>
  get<ContextContent = unknown>(
    identifier: ContextIdentifier,
  ): Promise<ReactionContextHandle<ContextContent, Runtime> | null>
  fromReaction<ContextContent = unknown>(
    reactionId: string,
  ): Promise<ReactionContextHandle<ContextContent, Runtime>>
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
    async fromReaction<ContextContent = unknown>(reactionId: string) {
      const id = reactionId.trim()
      if (!id) throw new Error("context_reaction_id_required")
      const { store } = await getContextRuntimeServices(runtime)
      const reaction = await store.getReaction(id)
      if (!reaction) throw new Error(`context_reaction_not_found:${id}`)
      const session = await store.getSession(reaction.sessionId)
      if (!session) throw new Error(`context_session_not_found:${reaction.sessionId}`)
      const handle = await ContextHandle.get<ContextContent>(runtime, {
        id: session.contextId,
      })
      if (!handle) throw new Error(`context_not_found:${session.contextId}`)
      return new ReactionContextHandle(runtime, handle.context, Object.freeze({
        sessionId: session.id,
        reactionId: reaction.id,
      }))
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

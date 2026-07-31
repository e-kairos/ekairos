import type { DomainEventDraft } from "@ekairos/domain"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

import { Events } from "./event.builder.js"
import { getContextRuntimeServices, type ContextRuntimeServiceHandle } from "./context.runtime.js"
import type {
  ContextEvent,
  ContextIdentifier,
  DomainEventItem,
  StoredContext,
} from "./context.store.js"

export type ContextHandleOpenParams<Content = unknown> = Readonly<
  ContextIdentifier & {
    content?: Content | null
  }
>

function identifierFrom(params: ContextHandleOpenParams): ContextIdentifier {
  if (params.id?.trim()) return { id: params.id.trim() }
  if (params.key?.trim()) return { key: params.key.trim() }
  throw new Error("context_identifier_required")
}

export class ContextHandle<Content = unknown> {
  readonly runtime: ContextRuntimeServiceHandle
  readonly context: StoredContext<Content>
  private appendTail: Promise<void> = Promise.resolve()

  constructor(runtime: ContextRuntimeServiceHandle, context: StoredContext<Content>) {
    this.runtime = runtime
    this.context = context
  }

  static [WORKFLOW_SERIALIZE](instance: ContextHandle<unknown>) {
    return { runtime: instance.runtime, context: instance.context }
  }

  static [WORKFLOW_DESERIALIZE](data: {
    runtime: ContextRuntimeServiceHandle
    context: StoredContext<unknown>
  }) {
    return new ContextHandle(data.runtime, data.context)
  }

  get id() {
    return this.context.id
  }

  get key() {
    return this.context.key
  }

  get content(): Content | null {
    return this.context.content
  }

  get events(): Promise<readonly ContextEvent[]> {
    return this.readEvents()
  }

  identifier(): ContextIdentifier {
    return { id: this.id }
  }

  async append<Payload>(
    draft: DomainEventDraft<Payload, any, any, any, any, any>,
  ): Promise<DomainEventItem<Payload>> {
    const pending = this.appendTail.then(() => this.appendNow(draft))
    this.appendTail = pending.then(
      () => undefined,
      () => undefined,
    )
    return await pending
  }

  private async appendNow<Payload>(
    draft: DomainEventDraft<Payload, any, any, any, any, any>,
  ): Promise<DomainEventItem<Payload>> {
    const timeline = await this.readEvents()
    const head = timeline[timeline.length - 1]
    return await Events(this.runtime).emit(draft, {
      contextId: this.id,
      metadata: {
        causeIds: head ? [head.id] : [],
      },
    })
  }

  private async readEvents(): Promise<readonly ContextEvent[]> {
    const { store } = await getContextRuntimeServices(this.runtime)
    return Object.freeze([...(await store.getEvents(this.identifier()))])
  }

  static async open<Content = unknown>(
    runtime: ContextRuntimeServiceHandle,
    params: ContextHandleOpenParams<Content>,
  ): Promise<ContextHandle<Content>> {
    const { store } = await getContextRuntimeServices(runtime)
    const identifier = identifierFrom(params)
    let context = await store.getOrCreateContext<Content>(identifier)
    if (params.content !== undefined) {
      context = await store.updateContextContent({ id: context.id }, params.content as Content)
    }
    return new ContextHandle(runtime, context)
  }
}

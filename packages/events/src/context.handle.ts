import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

import { getContextRuntimeServices, type ContextRuntimeServiceHandle } from "./context.runtime.js"
import type {
  ContextEvent,
  ContextIdentifier,
  ContextReaction,
  ContextSession,
  ContextStore,
  StoredContext,
} from "./context.store.js"

export type ContextHandleCreateParams<Content = unknown> = Readonly<{
  id?: string
  key?: string
  name?: string
  content?: Content | null
}>

function identifierFrom(params: ContextHandleCreateParams): ContextIdentifier {
  if (params.id?.trim()) return { id: params.id.trim() }
  if (params.key?.trim()) return { key: params.key.trim() }
  return { id: globalThis.crypto.randomUUID() }
}

export class ContextHandle<Content = unknown> {
  readonly runtime: ContextRuntimeServiceHandle
  readonly context: StoredContext<Content>

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

  get previous(): Content | undefined {
    return this.context.previous
  }

  identifier(): ContextIdentifier {
    return { id: this.id }
  }

  async refresh(): Promise<ContextHandle<Content>> {
    const { store } = await getContextRuntimeServices(this.runtime)
    const context = await store.getContext<Content>(this.identifier())
    if (!context) throw new Error(`context_not_found:${this.id}`)
    return new ContextHandle(this.runtime, context)
  }

  async updateContent(content: Content): Promise<ContextHandle<Content>> {
    const { store } = await getContextRuntimeServices(this.runtime)
    return new ContextHandle(
      this.runtime,
      await store.updateContextContent(this.identifier(), content),
    )
  }

  async openSession(
    input: Omit<Parameters<ContextStore["openSession"]>[0], "contextId">,
  ): Promise<ContextSession> {
    const { store } = await getContextRuntimeServices(this.runtime)
    return await store.openSession({ ...input, contextId: this.id })
  }

  async openReaction(
    input: Parameters<ContextStore["openReaction"]>[0],
  ): Promise<ContextReaction> {
    const { store } = await getContextRuntimeServices(this.runtime)
    return await store.openReaction(input)
  }

  async event<Payload>(eventId: string): Promise<ContextEvent<Payload> | null> {
    const { store } = await getContextRuntimeServices(this.runtime)
    return await store.getEvent<Payload>(eventId)
  }

  static async get<Content = unknown>(
    runtime: ContextRuntimeServiceHandle,
    identifier: ContextIdentifier,
  ): Promise<ContextHandle<Content> | null> {
    const { store } = await getContextRuntimeServices(runtime)
    const context = await store.getContext<Content>(identifier)
    return context ? new ContextHandle(runtime, context) : null
  }

  static async create<Content = unknown>(
    runtime: ContextRuntimeServiceHandle,
    params: ContextHandleCreateParams<Content>,
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

export async function createContextHandle<Content = unknown>(
  runtime: ContextRuntimeServiceHandle,
  params: ContextHandleCreateParams<Content>,
) {
  return await ContextHandle.create(runtime, params)
}

export async function getContextHandle<Content = unknown>(
  runtime: ContextRuntimeServiceHandle,
  identifier: ContextIdentifier,
) {
  return await ContextHandle.get<Content>(runtime, identifier)
}

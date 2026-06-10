import type {
  ContextIdentifier,
  ContextResource,
  ContextStatus,
  ContextStore,
  StoredContext,
  StoredContextResource,
} from "@ekairos/events";
import type { ChannelMessage, ChannelMessageStore } from "@ekairos/channel";
import { generateAgentId, type AgentItem } from "./items.js";

export type ThreadRecord = {
  id: string;
  key: string | null;
  title: string | null;
  status: string | null;
  createdAt: Date;
  updatedAt?: Date;
  /** The context this thread indirects to. */
  contextId: string;
};

export type ThreadIdentifier = { id: string; key?: never } | { key: string; id?: never };

/**
 * Persistence contract for the thread indirection (`agent_threads`).
 * `getOrCreateThread` must also ensure the linked context exists.
 */
export interface ThreadStore {
  getOrCreateThread(params: { key?: string | null; title?: string | null }): Promise<ThreadRecord>;
  getThread(identifier: ThreadIdentifier): Promise<ThreadRecord | null>;
  updateThread(
    identifier: ThreadIdentifier,
    patch: Partial<Pick<ThreadRecord, "title" | "status">>,
  ): Promise<ThreadRecord>;
}

/** Everything a thread runtime needs from persistence. */
export type AgentStore = ContextStore & ThreadStore & ChannelMessageStore;

type MemoryExecution = {
  id: string;
  contextId: string;
  triggerEventId: string;
  reactionEventId: string;
  status: "executing" | "completed" | "failed";
};

type MemoryStep = {
  id: string;
  executionId: string;
  iteration: number;
  status: "running" | "completed" | "failed";
  parts: unknown[];
  patch: Record<string, unknown>;
};

/**
 * In-memory AgentStore for local/embedded agent runtimes (Electron main,
 * CLIs, tests). Implements the @ekairos/events ContextStore contract plus the
 * thread indirection and the @ekairos/channel message store, so runtimes can
 * swap it for an InstantDB-backed store without touching transports or UI.
 */
export class MemoryAgentStore implements ContextStore, ThreadStore, ChannelMessageStore {
  #contextsById = new Map<string, StoredContext<unknown>>();
  #contextIdByKey = new Map<string, string>();
  #itemsByContextId = new Map<string, AgentItem[]>();
  #itemIndex = new Map<string, { contextId: string; item: AgentItem }>();
  #executions = new Map<string, MemoryExecution>();
  #steps = new Map<string, MemoryStep>();
  #resourcesByContextId = new Map<string, StoredContextResource[]>();
  #threadsById = new Map<string, ThreadRecord>();
  #threadIdByKey = new Map<string, string>();
  #channelMessagesByContextId = new Map<string, ChannelMessage[]>();

  // --- ThreadStore -------------------------------------------------------

  async getOrCreateThread(params: { key?: string | null; title?: string | null }): Promise<ThreadRecord> {
    const key = params.key ?? null;
    if (key) {
      const existingId = this.#threadIdByKey.get(key);
      if (existingId) {
        return this.#threadsById.get(existingId)!;
      }
    }
    const context = await this.getOrCreateContext(null);
    const thread: ThreadRecord = {
      id: generateAgentId(),
      key,
      title: params.title ?? null,
      status: "open",
      createdAt: new Date(),
      contextId: context.id,
    };
    this.#threadsById.set(thread.id, thread);
    if (key) {
      this.#threadIdByKey.set(key, thread.id);
    }
    return thread;
  }

  async getThread(identifier: ThreadIdentifier): Promise<ThreadRecord | null> {
    if ("id" in identifier && identifier.id) {
      return this.#threadsById.get(identifier.id) ?? null;
    }
    if ("key" in identifier && identifier.key) {
      const id = this.#threadIdByKey.get(identifier.key);
      return id ? this.#threadsById.get(id) ?? null : null;
    }
    return null;
  }

  async updateThread(
    identifier: ThreadIdentifier,
    patch: Partial<Pick<ThreadRecord, "title" | "status">>,
  ): Promise<ThreadRecord> {
    const thread = await this.getThread(identifier);
    if (!thread) {
      throw new Error("MemoryAgentStore.updateThread: thread not found");
    }
    const next = { ...thread, ...patch, updatedAt: new Date() };
    this.#threadsById.set(thread.id, next);
    return next;
  }

  // --- ChannelMessageStore ----------------------------------------------

  async saveChannelMessage(message: ChannelMessage): Promise<ChannelMessage> {
    const contextId = message.contextId;
    if (!contextId) {
      throw new Error("MemoryAgentStore.saveChannelMessage: message.contextId is required");
    }
    const messages = this.#channelMessagesByContextId.get(contextId) ?? [];
    messages.push(message);
    this.#channelMessagesByContextId.set(contextId, messages);
    return message;
  }

  async getChannelMessages(params: { contextId: string }): Promise<ChannelMessage[]> {
    return [...(this.#channelMessagesByContextId.get(params.contextId) ?? [])];
  }

  // --- ContextStore ------------------------------------------------------

  #resolveContextId(contextIdentifier: ContextIdentifier): string | null {
    if ("id" in contextIdentifier && contextIdentifier.id) {
      return contextIdentifier.id;
    }
    if ("key" in contextIdentifier && contextIdentifier.key) {
      return this.#contextIdByKey.get(contextIdentifier.key) ?? null;
    }
    return null;
  }

  #requireContext(contextIdentifier: ContextIdentifier): StoredContext<unknown> {
    const id = this.#resolveContextId(contextIdentifier);
    const context = id ? this.#contextsById.get(id) : null;
    if (!context) {
      throw new Error("MemoryContextStore: context not found");
    }
    return context;
  }

  #patchContext<C>(
    contextIdentifier: ContextIdentifier,
    patch: Partial<StoredContext<unknown>>,
  ): StoredContext<C> {
    const current = this.#requireContext(contextIdentifier);
    const next = { ...current, ...patch, updatedAt: new Date() };
    this.#contextsById.set(current.id, next);
    return next as StoredContext<C>;
  }

  async getOrCreateContext<C>(contextIdentifier: ContextIdentifier | null): Promise<StoredContext<C>> {
    if (contextIdentifier) {
      const existingId = this.#resolveContextId(contextIdentifier);
      if (existingId) {
        return this.#contextsById.get(existingId) as StoredContext<C>;
      }
    }

    const key = contextIdentifier && "key" in contextIdentifier ? contextIdentifier.key ?? null : null;
    const created: StoredContext<C> = {
      id: generateAgentId(),
      key,
      name: null,
      status: "open_idle",
      createdAt: new Date(),
      content: null,
    };
    this.#contextsById.set(created.id, created as StoredContext<unknown>);
    if (key) {
      this.#contextIdByKey.set(key, created.id);
    }
    this.#itemsByContextId.set(created.id, []);
    return created;
  }

  async getContext<C>(contextIdentifier: ContextIdentifier): Promise<StoredContext<C> | null> {
    const id = this.#resolveContextId(contextIdentifier);
    if (!id) return null;
    return (this.#contextsById.get(id) as StoredContext<C>) ?? null;
  }

  async updateContextContent<C>(contextIdentifier: ContextIdentifier, content: C): Promise<StoredContext<C>> {
    return this.#patchContext<C>(contextIdentifier, { content: content as unknown });
  }

  async updateContextDefinition<C>(
    contextIdentifier: ContextIdentifier,
    definition: { description?: string | null; goal?: string | null },
  ): Promise<StoredContext<C>> {
    return this.#patchContext<C>(contextIdentifier, definition);
  }

  async upsertContextResources(
    contextIdentifier: ContextIdentifier,
    resources: ContextResource[],
  ): Promise<StoredContextResource[]> {
    const context = this.#requireContext(contextIdentifier);
    const existing = this.#resourcesByContextId.get(context.id) ?? [];
    const byKey = new Map(existing.map((resource) => [resource.key, resource]));
    for (const resource of resources) {
      const current = byKey.get(resource.key);
      byKey.set(resource.key, {
        ...current,
        ...resource,
        id: current?.id ?? generateAgentId(),
        createdAt: current?.createdAt ?? new Date(),
        updatedAt: new Date(),
      });
    }
    const next = [...byKey.values()];
    this.#resourcesByContextId.set(context.id, next);
    this.#patchContext(contextIdentifier, { resources: next });
    return next;
  }

  async getContextResources(contextIdentifier: ContextIdentifier): Promise<StoredContextResource[]> {
    const id = this.#resolveContextId(contextIdentifier);
    if (!id) return [];
    return [...(this.#resourcesByContextId.get(id) ?? [])];
  }

  async updateContextReactor<C>(
    contextIdentifier: ContextIdentifier,
    reactor: { kind: string; state?: Record<string, unknown> | null },
  ): Promise<StoredContext<C>> {
    return this.#patchContext<C>(contextIdentifier, { reactor });
  }

  async updateContextStatus(contextIdentifier: ContextIdentifier, status: ContextStatus): Promise<void> {
    const id = this.#resolveContextId(contextIdentifier);
    if (!id) return;
    const current = this.#contextsById.get(id);
    if (!current) return;
    this.#contextsById.set(id, { ...current, status, updatedAt: new Date() });
  }

  async saveItem(contextIdentifier: ContextIdentifier, item: AgentItem): Promise<AgentItem> {
    const id = this.#resolveContextId(contextIdentifier);
    if (!id) {
      throw new Error("MemoryContextStore.saveItem: context not found");
    }
    const items = this.#itemsByContextId.get(id) ?? [];
    items.push(item);
    this.#itemsByContextId.set(id, items);
    this.#itemIndex.set(item.id, { contextId: id, item });
    return item;
  }

  async updateItem(itemId: string, item: AgentItem): Promise<AgentItem> {
    const entry = this.#itemIndex.get(itemId);
    if (!entry) {
      throw new Error(`MemoryContextStore.updateItem: item ${itemId} not found`);
    }
    const items = this.#itemsByContextId.get(entry.contextId) ?? [];
    const index = items.findIndex((candidate) => candidate.id === itemId);
    if (index >= 0) {
      items[index] = item;
    }
    this.#itemIndex.set(itemId, { contextId: entry.contextId, item });
    return item;
  }

  async getItem(itemId: string): Promise<AgentItem | null> {
    return this.#itemIndex.get(itemId)?.item ?? null;
  }

  async getItems(contextIdentifier: ContextIdentifier): Promise<AgentItem[]> {
    const id = this.#resolveContextId(contextIdentifier);
    if (!id) return [];
    return [...(this.#itemsByContextId.get(id) ?? [])];
  }

  async createExecution(
    contextIdentifier: ContextIdentifier,
    triggerEventId: string,
    reactionEventId: string,
  ): Promise<{ id: string }> {
    const contextId = this.#resolveContextId(contextIdentifier);
    if (!contextId) {
      throw new Error("MemoryContextStore.createExecution: context not found");
    }
    const execution: MemoryExecution = {
      id: generateAgentId(),
      contextId,
      triggerEventId,
      reactionEventId,
      status: "executing",
    };
    this.#executions.set(execution.id, execution);
    return { id: execution.id };
  }

  async completeExecution(
    _contextIdentifier: ContextIdentifier,
    executionId: string,
    status: "completed" | "failed",
  ): Promise<void> {
    const execution = this.#executions.get(executionId);
    if (!execution) return;
    this.#executions.set(executionId, { ...execution, status });
  }

  async createStep(params: { executionId: string; iteration: number }): Promise<{ id: string }> {
    const step: MemoryStep = {
      id: generateAgentId(),
      executionId: params.executionId,
      iteration: params.iteration,
      status: "running",
      parts: [],
      patch: {},
    };
    this.#steps.set(step.id, step);
    return { id: step.id };
  }

  async updateStep(stepId: string, patch: Record<string, unknown>): Promise<void> {
    const step = this.#steps.get(stepId);
    if (!step) return;
    const status = typeof patch.status === "string" ? (patch.status as MemoryStep["status"]) : step.status;
    this.#steps.set(stepId, { ...step, status, patch: { ...step.patch, ...patch } });
  }

  async saveStepParts(params: { stepId: string; parts: any[] }): Promise<void> {
    const step = this.#steps.get(params.stepId);
    if (!step) return;
    this.#steps.set(params.stepId, { ...step, parts: [...step.parts, ...params.parts] });
  }

  async linkItemToExecution(_params: { itemId: string; executionId: string }): Promise<void> {
    // Items and executions are already correlated in memory via execution records.
  }

  async itemsToModelMessages(items: AgentItem[]): Promise<never[]> {
    void items;
    return [];
  }
}

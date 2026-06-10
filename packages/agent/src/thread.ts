import {
  createTextInputItem,
  generateAgentId,
  type AgentContextMeta,
  type AgentItem,
  type AgentItemChannel,
} from "./items.js";
import { MemoryAgentStore, type AgentStore, type ThreadRecord } from "./store.js";
import type { AgentReactor } from "./reactor.js";
import type {
  ThreadMeta,
  ThreadSendInput,
  ThreadSnapshot,
  ThreadTransport,
  ThreadTransportEvent,
  ThreadTurnStatus,
} from "./transport.js";

export type ThreadOptions<Env extends Record<string, unknown> = Record<string, unknown>> = {
  /** Stable thread key. One thread = one durable context behind it. */
  key: string;
  title?: string;
  reactor: AgentReactor<Env>;
  env?: Env;
  store?: AgentStore;
  /** Channel tag persisted on items produced by this transport (default web). */
  itemChannel?: AgentItemChannel;
};

/**
 * A live thread: the unit applications talk to. Implements ThreadTransport,
 * so it can be exposed directly over IPC/HTTP or consumed in-process by
 * `useThread`.
 */
export type Thread = ThreadTransport & {
  readonly key: string;
  status(): ThreadTurnStatus;
};

function toThreadMeta(record: ThreadRecord): ThreadMeta {
  return {
    id: record.id,
    key: record.key,
    title: record.title,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt ? record.updatedAt.toISOString() : null,
    contextId: record.contextId,
  };
}

function toContextMeta(stored: {
  id: string;
  key: string | null;
  name?: string | null;
  status: AgentContextMeta["status"];
  content: unknown;
  createdAt: Date;
  updatedAt?: Date;
}): AgentContextMeta {
  return {
    id: stored.id,
    key: stored.key,
    name: stored.name ?? null,
    status: stored.status,
    content: (stored.content as Record<string, unknown> | null) ?? null,
    createdAt: stored.createdAt ? new Date(stored.createdAt).toISOString() : null,
    updatedAt: stored.updatedAt ? new Date(stored.updatedAt).toISOString() : null,
  };
}

/**
 * Creates a thread: ensures the `agent_threads` indirection and its context,
 * and reacts to input *on the thread*. The thread delegates everything below
 * to the context (@ekairos/events) and reads channel messages
 * (@ekairos/channel) from the same context for the snapshot.
 *
 * NOTE: the reaction loop runs locally (trigger → execution → step →
 * assistant item) honoring the events store contract. Delegating to
 * ContextEngine.react with an injected runtime is the planned upgrade; the
 * Thread surface does not change when that lands.
 */
export function createThread<Env extends Record<string, unknown> = Record<string, unknown>>(
  options: ThreadOptions<Env>,
): Thread {
  const store: AgentStore = options.store ?? new MemoryAgentStore();
  const itemChannel = options.itemChannel ?? "web";
  const listeners = new Set<(event: ThreadTransportEvent) => void>();
  let turnStatus: ThreadTurnStatus = "idle";

  const emit = (event: ThreadTransportEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // listeners must not break the thread
      }
    }
  };

  const setStatus = (status: ThreadTurnStatus, error?: string) => {
    turnStatus = status;
    emit({ type: "status", status, error });
  };

  const ensureThread = async (): Promise<ThreadRecord> => {
    return await store.getOrCreateThread({ key: options.key, title: options.title ?? null });
  };

  const send = async (input: ThreadSendInput): Promise<void> => {
    const text = input.text.trim();
    if (!text) return;
    if (turnStatus === "streaming") {
      throw new Error("thread_busy");
    }

    const thread = await ensureThread();
    const contextIdentifier = { id: thread.contextId } as const;
    const context = await store.getContext<Record<string, unknown>>(contextIdentifier);
    if (!context) {
      throw new Error("thread_context_missing");
    }

    const trigger = createTextInputItem(text, itemChannel);
    await store.saveItem(contextIdentifier, trigger);
    emit({ type: "item", item: trigger });
    setStatus("streaming");
    await store.updateContextStatus(contextIdentifier, "open_streaming");

    const reactionId = generateAgentId();
    const execution = await store.createExecution(contextIdentifier, trigger.id, reactionId);
    const step = await store.createStep({ executionId: execution.id, iteration: 0 });

    try {
      const result = await options.reactor({
        env: (options.env ?? {}) as Env,
        context,
        triggerEvent: trigger,
        threadId: thread.id,
        contextId: thread.contextId,
        executionId: execution.id,
        stepId: step.id,
        eventId: reactionId,
        iteration: 0,
        emitChunk: (chunk) => emit({ type: "chunk", chunk }),
      });

      const assistantEvent: AgentItem = { ...result.assistantEvent, id: reactionId };
      await store.saveItem(contextIdentifier, assistantEvent);
      await store.saveStepParts({
        stepId: step.id,
        parts: Array.isArray(assistantEvent.content?.parts) ? assistantEvent.content.parts : [],
      });
      await store.updateStep(step.id, { status: "completed" });
      await store.completeExecution(contextIdentifier, execution.id, "completed");
      await store.updateContextStatus(contextIdentifier, "open_idle");

      emit({ type: "item", item: assistantEvent });
      setStatus("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.updateStep(step.id, { status: "failed", errorText: message });
      await store.completeExecution(contextIdentifier, execution.id, "failed");
      await store.updateContextStatus(contextIdentifier, "open_idle");
      setStatus("error", message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const snapshot = async (): Promise<ThreadSnapshot> => {
    const thread = await ensureThread();
    const context = await store.getContext<Record<string, unknown>>({ id: thread.contextId });
    const items = await store.getItems({ id: thread.contextId });
    const messages = await store.getChannelMessages({ contextId: thread.contextId });
    return {
      thread: toThreadMeta(thread),
      context: context ? toContextMeta(context) : null,
      items,
      messages,
    };
  };

  return {
    key: options.key,
    status: () => turnStatus,
    send,
    snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

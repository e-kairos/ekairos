"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContext } from "@ekairos/events/react";
import type {
  ContextEventForUI,
  ContextValue,
  UseContextOptions,
  UseContextStateHook,
} from "@ekairos/events/react";
import type { ChannelMessage } from "@ekairos/channel";
import type { AgentContextMeta, AgentItem } from "./items.js";
import type {
  ThreadMeta,
  ThreadSnapshot,
  ThreadTransport,
  ThreadTurnStatus,
} from "./transport.js";

/** A context event enriched with the channel messages linked to it. */
export type ThreadEventForUI = ContextEventForUI & {
  channelMessages?: ChannelMessage[];
};

/** One conversation timeline across every channel: context events interleaved
 * with channel messages (email, whatsapp, slack, ...) that are not already
 * attached to an event. */
export type ThreadTimelineEntry =
  | { kind: "event"; at: string; event: ThreadEventForUI }
  | { kind: "message"; at: string; message: ChannelMessage };

export type UseThreadOptions = {
  /** Stable thread key (agent_threads.key). */
  key: string;
  /** Endpoint that runs the thread reaction server-side (append posts here).
   * Reads never go through it: data is reactive InstantDB. */
  apiUrl: string;
  onContextUpdate?: UseContextOptions["onContextUpdate"];
  prepareAppendArgs?: UseContextOptions["prepareAppendArgs"];
  prepareRequestBody?: UseContextOptions["prepareRequestBody"];
  enableResumableStreams?: UseContextOptions["enableResumableStreams"];
};

export type ThreadValue = ContextValue & {
  thread: ThreadMeta | null;
  /** Every channel message attached to the thread's context. */
  messages: ChannelMessage[];
  /** Context events + unattached channel messages, in chronological order. */
  timeline: ThreadTimelineEntry[];
};

function toMillis(value: string | Date | undefined): number {
  if (!value) return 0;
  return new Date(value).getTime();
}

function buildTimeline(
  events: ThreadEventForUI[],
  messages: ChannelMessage[],
): ThreadTimelineEntry[] {
  const attached = new Set<string>();
  for (const event of events) {
    for (const message of event.channelMessages ?? []) {
      attached.add(message.id);
    }
  }
  const entries: ThreadTimelineEntry[] = events.map((event) => ({
    kind: "event" as const,
    at: new Date(event.createdAt).toISOString(),
    event,
  }));
  for (const message of messages) {
    if (attached.has(message.id)) continue; // rendered inside its event
    entries.push({ kind: "message", at: message.createdAt, message });
  }
  return entries.sort((a, b) => toMillis(a.at) - toMillis(b.at));
}

/**
 * Thread state hook: the domain query behind useThread. Brings the context,
 * its items in order, and the channel messages linked to each item — straight
 * from InstantDB, no data APIs.
 */
const threadStateHook: UseContextStateHook = (db, { contextId }) => {
  const query = db.useQuery(
    contextId
      ? {
          event_contexts: {
            $: { where: { id: contextId } },
          },
          event_items: {
            $: {
              where: { "context.id": contextId },
              order: { createdAt: "asc" as const },
            },
            channelMessages: {},
          },
        }
      : null,
  );

  const contextRow = query?.data?.event_contexts?.[0] ?? null;
  const items = Array.isArray(query?.data?.event_items) ? query.data.event_items : [];

  return {
    context: contextRow,
    contextStatus: (contextRow?.status as ThreadValue["contextStatus"]) ?? "open_idle",
    events: items as ContextEventForUI[],
  };
};

/**
 * Canonical thread hook: InstantDB-first, domain-driven. Internally composes
 * `useContext` from @ekairos/events/react (reactive context state) with the
 * agent domain query (`agent_threads` indirection) and the channel domain
 * query (`channel_messages`), so one hook returns the whole multichannel
 * conversation. Reads are reactive InstantDB queries; only `append` touches
 * the reaction endpoint.
 */
export function useThread(db: any, options: UseThreadOptions): ThreadValue {
  const threadQuery = db.useQuery({
    agent_threads: {
      $: { where: { key: options.key } },
      context: {},
    },
  });

  const threadRow = threadQuery?.data?.agent_threads?.[0] ?? null;
  const linkedContext = Array.isArray(threadRow?.context)
    ? threadRow?.context?.[0]
    : threadRow?.context;
  const contextId: string | null = linkedContext?.id ?? null;

  const contextValue = useContext(db, {
    apiUrl: options.apiUrl,
    initialContextId: contextId ?? undefined,
    onContextUpdate: options.onContextUpdate,
    prepareAppendArgs: options.prepareAppendArgs,
    prepareRequestBody: options.prepareRequestBody,
    enableResumableStreams: options.enableResumableStreams,
    state: threadStateHook,
  });

  const messagesQuery = db.useQuery(
    contextId
      ? {
          channel_messages: {
            $: {
              where: { "context.id": contextId },
              order: { createdAt: "asc" as const },
            },
            item: {},
          },
        }
      : null,
  );

  const rawMessages = Array.isArray(messagesQuery?.data?.channel_messages)
    ? messagesQuery.data.channel_messages
    : [];
  const messages: ChannelMessage[] = rawMessages.map((row: any) => ({
    ...row,
    itemId: Array.isArray(row.item) ? row.item?.[0]?.id : row.item?.id,
    contextId: contextId ?? undefined,
  }));

  const thread: ThreadMeta | null = threadRow
    ? {
        id: threadRow.id,
        key: threadRow.key ?? null,
        title: threadRow.title ?? null,
        status: threadRow.status ?? null,
        createdAt: threadRow.createdAt ? new Date(threadRow.createdAt).toISOString() : "",
        updatedAt: threadRow.updatedAt ? new Date(threadRow.updatedAt).toISOString() : null,
        contextId: contextId ?? "",
      }
    : null;

  const timeline = useMemo(
    () => buildTimeline(contextValue.events as ThreadEventForUI[], messages),
    [contextValue.events, messages],
  );

  return {
    ...contextValue,
    thread,
    messages,
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Embedded runtimes (Electron, CLIs, tests): same thread surface over a
// ThreadTransport instead of InstantDB.
// ---------------------------------------------------------------------------

export type UseThreadTransportOptions = {
  thread: ThreadTransport | null;
};

export type ThreadTransportValue = {
  thread: ThreadMeta | null;
  context: AgentContextMeta | null;
  items: AgentItem[];
  messages: ChannelMessage[];
  status: ThreadTurnStatus;
  error: string | null;
  isLoading: boolean;
  streamingText: string;
  streamingReasoning: string;
  activity: string | null;
  send: (text: string) => Promise<void>;
  refresh: () => Promise<void>;
};

export function useThreadTransport(options: UseThreadTransportOptions): ThreadTransportValue {
  const { thread } = options;

  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<ThreadTurnStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [activity, setActivity] = useState<string | null>(null);

  const threadRef = useRef(thread);
  threadRef.current = thread;

  const refresh = useCallback(async () => {
    const current = threadRef.current;
    if (!current) return;
    try {
      setSnapshot(await current.snapshot());
      setError(null);
    } catch (snapshotError) {
      setError(snapshotError instanceof Error ? snapshotError.message : String(snapshotError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!thread) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    void refresh();

    const unsubscribe = thread.subscribe((event) => {
      if (event.type === "item" || event.type === "message") {
        setStreamingText("");
        setStreamingReasoning("");
        setActivity(null);
        void refresh();
        return;
      }
      if (event.type === "status") {
        setStatus(event.status);
        setError(event.status === "error" ? (event.error ?? "thread_error") : null);
        if (event.status !== "streaming") {
          setActivity(null);
        }
        return;
      }
      if (event.type === "chunk") {
        const chunk = event.chunk;
        if (chunk.kind === "text-delta") {
          setStreamingText((current) => current + chunk.text);
        } else if (chunk.kind === "reasoning-delta") {
          setStreamingReasoning((current) => current + chunk.text);
        } else if (chunk.kind === "activity") {
          setActivity(chunk.label);
        }
      }
    });
    return unsubscribe;
  }, [thread, refresh]);

  const send = useCallback(async (text: string) => {
    const current = threadRef.current;
    if (!current) {
      throw new Error("thread_unavailable");
    }
    await current.send({ text });
  }, []);

  return {
    thread: snapshot?.thread ?? null,
    context: snapshot?.context ?? null,
    items: snapshot?.items ?? [],
    messages: snapshot?.messages ?? [],
    status,
    error,
    isLoading,
    streamingText,
    streamingReasoning,
    activity,
    send,
    refresh,
  };
}

export {
  getItemReasoning,
  getItemText,
  type AgentContextMeta,
  type AgentItem,
} from "./items.js";
export type {
  ThreadChunk,
  ThreadMeta,
  ThreadSendInput,
  ThreadSnapshot,
  ThreadTransport,
  ThreadTransportEvent,
  ThreadTurnStatus,
} from "./transport.js";
export type { ChannelMessage } from "@ekairos/channel";

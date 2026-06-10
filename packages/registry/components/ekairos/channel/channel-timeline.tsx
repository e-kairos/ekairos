"use client";

import { useMemo } from "react";
import type { ChannelMessage } from "@ekairos/channel";
import { cn } from "@/lib/utils";
import { ChannelMessageBubble } from "@/components/ekairos/channel/channel-message";

export type ChannelTimelineProps = {
  /**
   * InstantDB react client with the channel domain schema. When provided with
   * `contextId`, the timeline queries `channel_messages` reactively — no
   * fetch, no API, no glue. This is the plug & play path.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: { useQuery: (query: any) => { data?: Record<string, unknown[]> } | undefined } | null;
  /** Agent context to read the conversation from. */
  contextId?: string | null;
  /** Static rows (demos, tests, server snapshots). Used when db is absent. */
  messages?: ChannelMessage[];
  /** Restrict to specific channels (default: all). */
  channels?: string[];
  className?: string;
  emptyState?: React.ReactNode;
};

function useChannelMessages(
  db: ChannelTimelineProps["db"],
  contextId: string | null | undefined,
  fallback: ChannelMessage[] | undefined,
): ChannelMessage[] {
  const query = db?.useQuery(
    contextId
      ? {
          channel_messages: {
            $: {
              where: { "context.id": contextId },
              order: { createdAt: "asc" },
            },
          },
        }
      : null,
  );
  const rows = query?.data?.channel_messages;
  if (Array.isArray(rows)) {
    return rows as ChannelMessage[];
  }
  return fallback ?? [];
}

function dayKey(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

/**
 * The whole conversation across every channel. Messages arrive interleaved in
 * chronological order with day separators — whatsapp next to email next to
 * web — because they all share one canonical schema on InstantDB.
 */
export function ChannelTimeline({
  db,
  contextId,
  messages,
  channels,
  className,
  emptyState,
}: ChannelTimelineProps) {
  const allMessages = useChannelMessages(db, contextId, messages);

  const visible = useMemo(() => {
    const filtered = channels?.length
      ? allMessages.filter((message) => channels.includes(message.channel))
      : allMessages;
    return [...filtered].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [allMessages, channels]);

  if (visible.length === 0) {
    return (
      <div className={cn("grid place-items-center py-12 text-sm text-muted-foreground", className)}>
        {emptyState ?? "No messages yet — every channel lands here."}
      </div>
    );
  }

  let lastDay = "";

  return (
    <div className={cn("grid gap-3", className)} role="log" aria-label="Channel timeline">
      {visible.map((message) => {
        const day = dayKey(message.createdAt);
        const showDay = day && day !== lastDay;
        lastDay = day || lastDay;
        return (
          <div key={message.id} className="grid gap-3">
            {showDay ? (
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-border" />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {day}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <ChannelMessageBubble message={message} />
          </div>
        );
      })}
    </div>
  );
}

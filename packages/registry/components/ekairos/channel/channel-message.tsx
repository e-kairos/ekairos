"use client";

import type { ChannelMessage } from "@ekairos/channel";
import { cn } from "@/lib/utils";
import { ChannelBadge } from "@/components/ekairos/channel/channel-badge";

export type ChannelMessageBubbleProps = {
  message: ChannelMessage;
  className?: string;
  /** Hide the channel badge (e.g. in single-channel views). */
  hideChannel?: boolean;
};

function formatTime(value: string | undefined): string {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function messageText(message: ChannelMessage): string {
  if (message.text) return message.text;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .map((part) =>
      part && typeof part === "object" && (part as { type?: unknown }).type === "text"
        ? String((part as { text?: unknown }).text ?? "")
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * Canonical message bubble for any channel_messages record: direction decides
 * the side, role decides the tone, the badge tells the platform. Works for
 * every channel because it renders the canonical model — not provider
 * payloads.
 */
export function ChannelMessageBubble({ message, className, hideChannel }: ChannelMessageBubbleProps) {
  const outbound = message.direction === "outbound";
  const author =
    message.participant ??
    (message.role === "assistant" ? "agent" : message.role ?? message.direction);

  return (
    <article className={cn("flex", outbound ? "justify-end" : "justify-start", className)}>
      <div
        className={cn(
          "max-w-[44rem] border px-4 py-3 text-sm leading-6",
          outbound
            ? "border-foreground/15 bg-foreground text-background"
            : "border-border bg-muted/40 text-foreground",
        )}
      >
        <div
          className={cn(
            "mb-1.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em]",
            outbound ? "text-background/60" : "text-muted-foreground",
          )}
        >
          <span className="font-mono">{author}</span>
          {!hideChannel ? (
            <ChannelBadge
              channel={message.channel}
              className={outbound ? "border-background/30 text-background/70" : undefined}
            />
          ) : null}
          {message.status ? <span className="font-mono opacity-70">{message.status}</span> : null}
          <span className="font-mono opacity-70">{formatTime(message.createdAt)}</span>
        </div>
        <p className="m-0 whitespace-pre-wrap break-words">{messageText(message)}</p>
      </div>
    </article>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { ChannelBadge } from "@/components/ekairos/channel/channel-badge";

export type ChannelComposerProps = {
  /**
   * Your send endpoint. The composer POSTs
   * `{ channel, text, contextId?, threadKey? }` as JSON — this endpoint is
   * the one piece of custom code an app owns (it calls the channel domain
   * server-side and triggers the agent reaction).
   */
  endpoint: string;
  contextId?: string;
  threadKey?: string;
  /** Channels the user can send through. Defaults to ["web"]. */
  channels?: string[];
  placeholder?: string;
  className?: string;
  onSent?: (params: { channel: string; text: string }) => void;
  onError?: (error: Error) => void;
};

/**
 * Outbound composer for a thread: pick the channel, write, send. Delivery and
 * persistence happen server-side through the channel domain; the timeline
 * updates reactively from InstantDB.
 */
export function ChannelComposer({
  endpoint,
  contextId,
  threadKey,
  channels = ["web"],
  placeholder = "Send a message",
  className,
  onSent,
  onError,
}: ChannelComposerProps) {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState(channels[0] ?? "web");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, text: trimmed, contextId, threadKey }),
      });
      if (!response.ok) {
        throw new Error(`channel_send_failed:${response.status}`);
      }
      setText("");
      onSent?.({ channel, text: trimmed });
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={cn("grid gap-2", className)} onSubmit={submit}>
      {channels.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {channels.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setChannel(kind)}
              className={cn(
                "transition-opacity",
                channel === kind ? "opacity-100" : "opacity-40 hover:opacity-70",
              )}
              aria-pressed={channel === kind}
            >
              <ChannelBadge channel={kind} />
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          className="min-h-11 flex-1 resize-none border border-border bg-background px-3 py-2.5 text-sm leading-5 outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground"
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          disabled={busy || text.trim().length === 0}
          className="min-h-11 border border-foreground bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "..." : "Send"}
        </button>
      </div>
    </form>
  );
}

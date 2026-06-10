"use client";

import { cn } from "@/lib/utils";

export type ChannelBadgeProps = {
  /** Channel kind: web, email, whatsapp, slack, teams, discord, telegram, ... */
  channel: string;
  className?: string;
};

const CHANNEL_ACCENTS: Record<string, string> = {
  web: "#61e9ff",
  email: "#f59e0b",
  whatsapp: "#25d366",
  slack: "#e01e5a",
  teams: "#6264a7",
  gchat: "#34a853",
  discord: "#5865f2",
  telegram: "#2aabee",
};

/**
 * Platform identity chip for a canonical channel message. Unknown channels
 * render with a neutral accent, so custom channels work out of the box.
 */
export function ChannelBadge({ channel, className }: ChannelBadgeProps) {
  const accent = CHANNEL_ACCENTS[channel] ?? "#a1a1aa";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: accent }}
      />
      {channel}
    </span>
  );
}

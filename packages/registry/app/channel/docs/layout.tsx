"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";

import { cn } from "@/lib/utils";

const NAV = [
  {
    section: "Getting started",
    links: [
      { href: "/channel/docs", label: "Overview" },
      { href: "/channel/docs/quickstart", label: "Quickstart" },
      { href: "/channel/demo", label: "Live demo" },
    ],
  },
  {
    section: "Concepts",
    links: [
      { href: "/channel/docs/concepts/messages", label: "Messages" },
      { href: "/channel/docs/concepts/platforms", label: "Platforms" },
      { href: "/channel/docs/concepts/threads", label: "Threads & contexts" },
      { href: "/channel/docs/concepts/state", label: "Runtime state" },
    ],
  },
  {
    section: "Components",
    links: [
      { href: "/channel/docs/components/channel-timeline", label: "ChannelTimeline" },
      { href: "/channel/docs/components/channel-message", label: "ChannelMessageBubble" },
      { href: "/channel/docs/components/channel-badge", label: "ChannelBadge" },
      { href: "/channel/docs/components/channel-composer", label: "ChannelComposer" },
    ],
  },
  {
    section: "Guides",
    links: [
      { href: "/channel/docs/guides/send", label: "Send messages" },
      { href: "/channel/docs/guides/webhooks", label: "Mount webhooks" },
      { href: "/channel/docs/guides/platform-setup", label: "Platform setup" },
      { href: "/channel/docs/guides/components", label: "Components overview" },
    ],
  },
  {
    section: "Reference",
    links: [
      { href: "/channel/docs/reference/create-channels", label: "createChannels" },
      { href: "/channel/docs/reference/schema", label: "Schema" },
      { href: "/channel/docs/reference/channel-message", label: "ChannelMessage" },
      { href: "/channel/docs/reference/adapters", label: "Adapters & registry" },
      { href: "/channel/docs/reference/use-thread", label: "useThread integration" },
    ],
  },
] as const;

export default function ChannelDocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/channel/docs" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-[calc(100svh-56px)] bg-background text-foreground">
      {open ? (
        <button
          type="button"
          aria-label="Close channel docs sidebar"
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-14 left-0 z-50 w-64 shrink-0 -translate-x-full overflow-y-auto border-r border-border bg-background transition-transform duration-300 lg:sticky lg:top-14 lg:h-[calc(100svh-56px)] lg:translate-x-0",
          open && "translate-x-0",
        )}
      >
        <div className="border-b border-border p-4">
          <Link href="/channel" className="font-mono text-xs text-[#0e7490]">
            /channel
          </Link>
          <p className="mt-2 text-sm font-semibold leading-tight">Channel docs</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Every channel. One thread. All on InstantDB.
          </p>
        </div>
        <nav className="grid gap-5 p-4">
          {NAV.map((group) => (
            <div key={group.section}>
              <p className="px-2 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                {group.section}
              </p>
              <div className="mt-2 grid gap-0.5">
                {group.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "border-l px-3 py-1.5 text-sm transition-colors",
                      isActive(link.href)
                        ? "border-[#0e7490] text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="sticky top-14 z-30 flex h-12 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label="Toggle channel docs sidebar"
            className="-ml-1 p-1.5 text-muted-foreground hover:text-foreground"
          >
            <Menu className="size-5" />
          </button>
          <span className="font-mono text-xs text-muted-foreground">channel docs</span>
        </div>
        {children}
      </div>
    </div>
  );
}

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
      { href: "/events", label: "Overview" },
      { href: "/events/components", label: "Components surface" },
    ],
  },
  {
    section: "Components",
    links: [
      { href: "/events/docs/components", label: "All components" },
      { href: "/events/docs/components/prompt", label: "Prompt" },
      { href: "/events/docs/components/prompt-file-chip", label: "PromptFileChip" },
      { href: "/events/docs/components/context-activity-indicator", label: "ContextActivityIndicator" },
      { href: "/events/docs/components/message-artifact", label: "MessageArtifact" },
      { href: "/events/docs/components/temporal-evidence-list", label: "TemporalEvidenceList" },
      { href: "/events/docs/components/source-watch-status", label: "SourceWatchStatus" },
    ],
  },
] as const;

export default function EventsDocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/events" || href === "/events/components" || href === "/events/docs/components"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-[calc(100svh-56px)] bg-background text-foreground">
      {open ? (
        <button
          type="button"
          aria-label="Close events docs sidebar"
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
          <Link href="/events" className="font-mono text-xs text-[#0891b2]">
            /events
          </Link>
          <p className="mt-2 text-sm font-semibold leading-tight">Events docs</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Context, prompt and execution UI for event-driven agents.
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
                        ? "border-[#0891b2] text-foreground"
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
            aria-label="Toggle events docs sidebar"
            className="-ml-1 p-1.5 text-muted-foreground hover:text-foreground"
          >
            <Menu className="size-5" />
          </button>
          <span className="font-mono text-xs text-muted-foreground">events docs</span>
        </div>
        {children}
      </div>
    </div>
  );
}

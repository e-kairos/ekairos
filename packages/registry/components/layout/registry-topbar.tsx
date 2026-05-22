"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { OrbLogo } from "@/components/ekairos/orb-logo";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Domains",
    match: (pathname: string) =>
      pathname === "/" ||
      pathname.startsWith("/events") ||
      pathname.startsWith("/docs/domains"),
  },
  {
    href: "/registry",
    label: "Manifest",
    match: (pathname: string) =>
      pathname.startsWith("/registry") || pathname.startsWith("/r/"),
  },
] as const;

export function RegistryTopbar() {
  const pathname = usePathname();

  return (
    <div className="fixed inset-x-0 top-0 z-[70] border-b border-border/80 bg-background dark:bg-black">
      <div className="flex h-14 w-full items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="flex h-8 min-w-0 shrink-0 items-center gap-2"
          aria-label="Ekairos Registry"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center">
            <OrbLogo size={32} ariaHidden />
          </span>
          <span className="hidden h-8 items-center border border-border/70 px-2 font-mono text-[11px] uppercase tracking-[0.24em] text-foreground sm:flex">
            registry
          </span>
        </Link>

        <nav
          aria-label="Registry navigation"
          className="flex min-w-0 items-center gap-1 overflow-x-auto font-mono text-[11px] uppercase tracking-[0.22em]"
        >
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex h-8 items-center px-2 transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {active ? (
                  <span className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] bg-primary" />
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

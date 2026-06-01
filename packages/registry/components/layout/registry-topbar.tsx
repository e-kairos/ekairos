"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { OrbLogo } from "@/components/ekairos/orb-logo";
import { domainRegistry } from "@/lib/domain-registry";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Domains",
    match: (pathname: string) =>
      pathname === "/" ||
      domainRegistry.some(
        (domain) => pathname === domain.href || pathname.startsWith(`${domain.href}/`),
      ) ||
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
    <div className="fixed inset-x-0 top-0 z-[70] border-b border-white/15 bg-black text-white">
      <div className="flex h-14 w-full items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="flex h-8 min-w-0 shrink-0 items-center gap-2"
          aria-label="Ekairos Registry"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center">
            <OrbLogo size={32} className="text-white" ariaHidden />
          </span>
          <span className="hidden h-8 items-center border border-white/20 px-2 font-mono text-[11px] uppercase tracking-[0.24em] text-white sm:flex">
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
                  active ? "text-white" : "text-white/55 hover:text-white",
                )}
              >
                {item.label}
                {active ? (
                  <span className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] bg-red-600" />
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { EkairosLogo } from "@/components/ekairos/ekairos-logo";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Registry", match: (pathname: string) => pathname === "/" },
  {
    href: "/docs/components/use-context",
    label: "useContext",
    match: (pathname: string) => pathname.startsWith("/docs/components/use-context"),
  },
] as const;

export function RegistryTopbar() {
  const pathname = usePathname();

  return (
    <div className="fixed inset-x-0 top-0 z-[70] border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-11 w-full max-w-5xl items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <EkairosLogo size="sm" />
          <span className="hidden text-sm font-medium sm:inline">Ekairos Registry</span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <a
            href="/r/use-context.json"
            className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            JSON
          </a>
        </nav>
      </div>
    </div>
  );
}

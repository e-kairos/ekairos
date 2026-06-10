"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Moon, Sun } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { domainRegistry } from "@/lib/domain-registry";
import { cn } from "@/lib/utils";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  const isDomainActive = (domainId: string) =>
    pathname === `/docs/domains/${domainId}` ||
    pathname.startsWith(`/docs/domains/${domainId}/`) ||
    pathname.startsWith(`/${domainId}`);
  const isComponentActive = (itemId: string) => pathname === `/docs/components/${itemId}`;
  const componentLinks = domainRegistry.flatMap((domain) =>
    domain.components
      .filter((component) => component.status === "published")
      .map((component) => ({ domain, component })),
  );
  const activeComponent =
    componentLinks.find(({ component }) => isComponentActive(component.id)) ?? null;
  const activeDomain =
    activeComponent?.domain ??
    domainRegistry.find((domain) => isDomainActive(domain.id)) ??
    null;

  return (
    <TooltipProvider>
      <div className="flex min-h-screen overflow-hidden bg-background text-foreground">
        {isSidebarOpen && (
          <button
            type="button"
            aria-label="Close docs sidebar"
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-64 flex-shrink-0 -translate-x-full flex-col border-r border-border/80 bg-background transition-transform duration-300 dark:bg-black lg:relative lg:translate-x-0",
            isSidebarOpen && "translate-x-0",
          )}
        >
          <div className="flex items-center justify-between border-b border-border/80 p-4">
            <Link
              href="/"
              className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground transition-colors hover:text-foreground"
            >
              registry docs
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              className="p-1 text-muted-foreground transition-colors hover:text-foreground"
              title="Toggle theme"
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 px-2 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              domains
            </div>
            <div className="grid gap-5">
              {domainRegistry.map((domain) => (
                <div key={domain.id} className="border-t border-border pt-3">
                  <Link
                    href={domain.href}
                    className={cn(
                      "block font-mono text-xs transition-colors",
                      isDomainActive(domain.id)
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    /{domain.id}
                  </Link>
                  <div className="mt-3 grid gap-1">
                    {domain.components.map((component) => (
                      <Link
                        key={component.id}
                        href={`/docs/components/${component.id}`}
                        className={cn(
                          "border-l px-3 py-1.5 text-sm transition-colors",
                          isComponentActive(component.id)
                            ? "border-foreground text-foreground"
                            : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
                        )}
                      >
                        {component.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
              <Link
                href="/registry"
                className="border-t border-border pt-3 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                /registry
              </Link>
            </div>
          </nav>
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <header
            className={cn(
              "fixed right-0 left-0 top-14 z-40 flex h-14 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur transition-all duration-300 supports-[backdrop-filter]:bg-background/60 lg:left-64",
            )}
          >
            <button
              type="button"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="-ml-2 p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Toggle docs sidebar"
            >
              <Menu className="size-5" />
            </button>
            <span className="text-sm font-medium">
              {activeComponent?.component.label ?? activeDomain?.title ?? "Domain components"}
            </span>
          </header>

          <div className="flex-1 overflow-auto pt-14">
            <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 md:px-6 md:py-8">
              {children}
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

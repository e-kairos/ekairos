"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Moon, Sun } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { registryData } from "@/lib/ui-registry";
import { cn } from "@/lib/utils";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  const isComponentActive = (itemId: string) =>
    pathname === `/docs/components/${itemId}`;

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
            "fixed inset-y-0 left-0 z-50 flex w-64 flex-shrink-0 flex-col border-r border-border/80 bg-card transition-transform duration-300 lg:relative lg:translate-x-0",
            !isSidebarOpen && "-translate-x-full lg:hidden",
          )}
        >
          <div className="flex items-center justify-between border-b border-border/80 p-4">
            <Link
              href="/"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              back to registry
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
            <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              public surface
            </div>
            <div className="space-y-1">
              {registryData.map((item) => (
                <Link
                  key={item.id}
                  href={`/docs/components/${item.id}`}
                  className={cn(
                    "block rounded-md px-3 py-1.5 text-sm transition-colors",
                    isComponentActive(item.id)
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {item.title}
                </Link>
              ))}
            </div>
          </nav>
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <header
            className={cn(
              "fixed right-0 left-0 top-11 z-40 flex h-14 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur transition-all duration-300 supports-[backdrop-filter]:bg-background/60",
              isSidebarOpen && "lg:left-64",
            )}
          >
            <button
              type="button"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="-ml-2 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Toggle docs sidebar"
            >
              <Menu className="size-5" />
            </button>
            <span className="text-sm font-medium">useContext</span>
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

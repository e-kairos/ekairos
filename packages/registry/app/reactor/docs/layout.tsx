"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { Menu } from "lucide-react"

import { reactorDocsNav } from "@/lib/reactor-docs"
import { cn } from "@/lib/utils"

export default function ReactorDocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const active = (href: string) => href === "/reactor/docs"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <div className="flex min-h-[calc(100svh-56px)] bg-background text-foreground">
      {open ? (
        <button
          type="button"
          aria-label="Close Reactor docs navigation"
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside className={cn(
        "fixed inset-y-14 left-0 z-50 w-64 shrink-0 -translate-x-full overflow-y-auto border-r border-border bg-background transition-transform lg:sticky lg:top-14 lg:h-[calc(100svh-56px)] lg:translate-x-0",
        open && "translate-x-0",
      )}>
        <div className="border-b border-border p-4">
          <Link href="/reactor/docs" className="font-mono text-xs text-cyan-700 dark:text-cyan-400">@ekairos/reactor</Link>
          <p className="mt-2 text-sm font-semibold">Reaction Engine</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Causality, domain actions, workspaces, datasets, and durable traces.</p>
        </div>
        <nav className="grid gap-5 p-4">
          {reactorDocsNav.map(group => (
            <div key={group.section}>
              <p className="px-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{group.section}</p>
              <div className="mt-2 grid gap-0.5">
                {group.links.map(link => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "border-l px-3 py-1.5 text-sm transition-colors",
                      active(link.href)
                        ? "border-cyan-700 text-foreground dark:border-cyan-400"
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
          <button type="button" onClick={() => setOpen(!open)} aria-label="Toggle Reactor docs navigation" className="-ml-1 p-1.5 text-muted-foreground hover:text-foreground">
            <Menu className="size-5" />
          </button>
          <span className="font-mono text-xs text-muted-foreground">Reaction Engine</span>
        </div>
        {children}
      </div>
    </div>
  )
}

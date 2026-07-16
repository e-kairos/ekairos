import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowRight, Check, FlaskConical, GitBranch } from "lucide-react"

import type { ReactorEvidenceId } from "@/lib/reactor-docs"
import { CodeCopyButton } from "./code-copy-button.client"

export function DocPage({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string
  title: string
  lead: ReactNode
  children: ReactNode
}) {
  return (
    <article className="mx-auto w-full max-w-4xl px-5 py-10 md:px-10 md:py-14">
      <header className="border-b border-border pb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-400">
          {eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">{title}</h1>
        <div className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">{lead}</div>
      </header>
      <div className="grid gap-12 pt-10">{children}</div>
    </article>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-")
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-semibold md:text-2xl">
        <a href={`#${id}`} className="hover:text-muted-foreground">{title}</a>
      </h2>
      <div className="mt-4 grid gap-4 text-sm leading-7 text-muted-foreground [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  )
}

export function Code({ title, children }: { title?: string; children: string }) {
  const code = children.replace(/\r\n?/g, "\n")
  return (
    <figure className="relative m-0 min-w-0">
      <CodeCopyButton code={code} hasCaption={Boolean(title)} />
      {title ? (
        <figcaption className="border border-b-0 border-border bg-muted/30 py-2 pl-3 pr-12 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </figcaption>
      ) : null}
      <pre className="m-0 max-h-[42rem] overflow-auto border border-border bg-neutral-950 py-4 pl-4 pr-12 font-mono text-xs leading-6 text-neutral-100">
        <code>{code}</code>
      </pre>
    </figure>
  )
}

export function InlineCode({ children }: { children: ReactNode }) {
  return <code className="bg-muted px-1 py-0.5 font-mono text-[0.86em] text-foreground">{children}</code>
}

export function Callout({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return (
    <div className={`border-l-2 px-4 py-3 ${warning ? "border-amber-600 bg-amber-500/5" : "border-cyan-700 bg-cyan-500/5"}`}>
      {children}
    </div>
  )
}

export function Invariants({ items }: { items: string[] }) {
  return (
    <ul className="divide-y divide-border border-y border-border">
      {items.map(item => (
        <li key={item} className="flex gap-3 py-3">
          <Check className="mt-1 size-4 shrink-0 text-cyan-700 dark:text-cyan-400" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function Evidence({ ids }: { ids: ReactorEvidenceId[] }) {
  return (
    <div className="border-y border-border">
      {ids.map(id => (
        <Link
          key={id}
          href={`/reactor/docs/evidence/${id}`}
          className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0 hover:text-foreground"
        >
          <span className="flex items-center gap-2">
            {id.includes("test") || id.includes("contract") ? <FlaskConical className="size-4" /> : <GitBranch className="size-4" />}
            {id}
          </span>
          <ArrowRight className="size-4" />
        </Link>
      ))}
    </div>
  )
}

export function Graph({ children }: { children: string }) {
  return <Code title="causal graph">{children}</Code>
}

export function NextLinks({ links }: { links: Array<{ href: string; label: string; detail: string }> }) {
  return (
    <nav className="grid border-y border-border md:grid-cols-2">
      {links.map(link => (
        <Link key={link.href} href={link.href} className="group border-b border-border py-4 md:border-r md:px-4 md:last:border-r-0">
          <span className="flex items-center gap-2 font-semibold text-foreground">
            {link.label}<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </span>
          <span className="mt-1 block text-sm leading-6">{link.detail}</span>
        </Link>
      ))}
    </nav>
  )
}

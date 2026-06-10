import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

export function DocPage({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 md:px-0 md:py-14">
      <header className="border-b border-border pb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#0e7490]">{eyebrow}</p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight md:text-5xl">{title}</h1>
        <div className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">{lead}</div>
      </header>
      <div className="grid gap-10 pt-10">{children}</div>
    </article>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-semibold md:text-2xl">
        <a href={`#${id}`} className="transition-colors hover:text-muted-foreground">
          {title}
        </a>
      </h2>
      <div className="mt-4 grid gap-4 text-sm leading-7 text-muted-foreground [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

export function Code({ title, children }: { title?: string; children: string }) {
  return (
    <figure className="m-0 grid">
      {title ? (
        <figcaption className="border border-b-0 border-border bg-muted/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </figcaption>
      ) : null}
      <pre className="m-0 overflow-x-auto border border-border bg-muted/45 p-4 font-mono text-xs leading-6 text-foreground">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="border border-border bg-muted/45 px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  );
}

export function Callout({ tone = "note", children }: { tone?: "note" | "warning"; children: ReactNode }) {
  return (
    <div
      className={
        tone === "warning"
          ? "border-l-2 border-amber-600 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-muted-foreground"
          : "border-l-2 border-[#0e7490] bg-[#0e7490]/5 px-4 py-3 text-sm leading-6 text-muted-foreground"
      }
    >
      {children}
    </div>
  );
}

export function PropsTable({
  rows,
}: {
  rows: Array<{ name: string; type: string; required?: boolean; description: ReactNode }>;
}) {
  return (
    <div className="overflow-x-auto border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left">
            <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              prop
            </th>
            <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              type
            </th>
            <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              description
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-border align-top last:border-b-0">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">
                {row.name}
                {row.required ? <span className="text-[#0e7490]"> *</span> : null}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.type}</td>
              <td className="px-3 py-2 text-sm leading-6 text-muted-foreground">{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NextLinks({
  links,
}: {
  links: Array<{ href: string; label: string; description: string }>;
}) {
  return (
    <nav className="grid gap-px border border-border bg-border md:grid-cols-2">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="group grid gap-1 bg-background p-4 transition-colors hover:bg-muted/40"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {link.label}
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
          <span className="text-sm leading-6 text-muted-foreground">{link.description}</span>
        </Link>
      ))}
    </nav>
  );
}

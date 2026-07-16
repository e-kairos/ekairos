import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import Link from "next/link"
import { notFound } from "next/navigation"

import {
  reactorEvidence,
  type ReactorEvidence,
  type ReactorEvidenceId,
} from "@/lib/reactor-docs"

export function generateStaticParams() {
  return Object.keys(reactorEvidence).map(id => ({ id }))
}

export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const evidence = reactorEvidence[id as ReactorEvidenceId] as ReactorEvidence | undefined
  if (!evidence) notFound()

  const repositoryRoot = resolve(process.cwd(), "..", "..")
  const absolutePath = resolve(repositoryRoot, evidence.path)
  if (!absolutePath.startsWith(repositoryRoot)) notFound()
  const source = await readFile(absolutePath, "utf8")
  const lines = source.split(/\r?\n/)
  const start = evidence.start ?? 1
  const end = evidence.end ?? lines.length
  if (start < 1 || end < start || end > lines.length) notFound()
  const excerpt = lines.slice(start - 1, end)

  return (
    <article className="mx-auto w-full max-w-6xl px-5 py-10 md:px-10">
      <Link href="/reactor/docs" className="font-mono text-xs text-cyan-700 dark:text-cyan-400">&lt;- Reactor docs</Link>
      <header className="mt-6 border-b border-border pb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{evidence.kind}</p>
        <h1 className="mt-2 text-2xl font-semibold md:text-4xl">{evidence.label}</h1>
        <p className="mt-3 font-mono text-xs text-muted-foreground">{evidence.path}:{start}-{end}</p>
      </header>
      <pre className="mt-8 max-h-[75svh] overflow-auto border border-border bg-neutral-950 p-4 font-mono text-xs leading-6 text-neutral-100">
        <code>{excerpt.map((line, index) => `${String(start + index).padStart(5, " ")}  ${line}`).join("\n")}</code>
      </pre>
    </article>
  )
}

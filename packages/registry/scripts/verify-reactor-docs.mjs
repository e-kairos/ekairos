import { access, readFile } from "node:fs/promises"
import { resolve } from "node:path"

const packageRoot = process.cwd()
const repositoryRoot = resolve(packageRoot, "..", "..")
const docsRoot = resolve(packageRoot, "app", "reactor", "docs")
const requiredPages = [
  "page.tsx",
  "events/page.tsx",
  "causality/page.tsx",
  "agent/page.tsx",
  "workspace/page.tsx",
  "dataset/page.tsx",
  "children/page.tsx",
  "persistence/page.tsx",
  "observability/page.tsx",
  "examples/page.tsx",
  "testing/page.tsx",
  "api/page.tsx",
  "evidence/[id]/page.tsx",
]

for (const relative of requiredPages) await access(resolve(docsRoot, relative))

const manifestPath = resolve(packageRoot, "lib", "reactor-docs.ts")
const manifest = await readFile(manifestPath, "utf8")
const evidenceBody = manifest
  .split("export const reactorEvidence = {")[1]
  ?.split("} as const satisfies Record<string, ReactorEvidence>")[0]
if (!evidenceBody) throw new Error("reactor_docs_evidence_manifest_missing")

const evidenceEntries = [...evidenceBody.matchAll(/"([^"]+)":\s*\{([\s\S]*?)\n\s*\},/g)]
  .map(([, id, body]) => ({
    id,
    path: body.match(/path: "([^"]+)"/)?.[1],
    start: Number(body.match(/start: (\d+)/)?.[1] ?? 1),
    end: body.match(/end: (\d+)/)?.[1]
      ? Number(body.match(/end: (\d+)/)?.[1])
      : undefined,
  }))
if (evidenceEntries.length < 20) throw new Error("reactor_docs_evidence_is_incomplete")
if (new Set(evidenceEntries.map(entry => entry.id)).size !== evidenceEntries.length) {
  throw new Error("reactor_docs_evidence_id_duplicated")
}
for (const entry of evidenceEntries) {
  if (!entry.path) throw new Error(`reactor_docs_evidence_path_missing:${entry.id}`)
  const absolute = resolve(repositoryRoot, entry.path)
  await access(absolute)
  const lineCount = (await readFile(absolute, "utf8")).split(/\r?\n/).length
  const end = entry.end ?? lineCount
  if (entry.start < 1 || end < entry.start || end > lineCount) {
    throw new Error(
      `reactor_docs_evidence_range_invalid:${entry.id}:${entry.start}-${end}/${lineCount}`,
    )
  }
}

const contentPages = requiredPages.filter(relative => relative !== "evidence/[id]/page.tsx")
const pages = await Promise.all(contentPages.map(relative => readFile(resolve(docsRoot, relative), "utf8")))
const corpus = pages.join("\n")
const activeApiCorpus = pages
  .filter((_, index) => contentPages[index] !== "api/page.tsx")
  .join("\n")

for (const required of [
  "contextDomain",
  "defineReaction",
  "reaction.given",
  ".emit(",
  ".agent(",
  ".action(",
  ".dataset(",
  ".workspace(",
  ".git(",
  ".shell(",
  "@ekairos/context",
  "context_sessions",
  "context_reactions",
  "context_eventParts",
  "typecheck:tests",
]) {
  if (!corpus.includes(required)) throw new Error(`reactor_docs_missing:${required}`)
}

if (corpus.includes("EKAIROS_RUN_REAL_AI")) {
  throw new Error("reactor_docs_obsolete_real_test_flag")
}

const evidenceIds = new Set(evidenceEntries.map(entry => entry.id))
for (const page of pages) {
  for (const match of page.matchAll(/<Evidence ids=\{\[([\s\S]*?)\]\}/g)) {
    for (const id of [...match[1].matchAll(/"([^"]+)"/g)].map(value => value[1])) {
      if (!evidenceIds.has(id)) throw new Error(`reactor_docs_unknown_evidence:${id}`)
    }
  }
}

for (const forbidden of [
  "defineReactor(",
  "ContextReactor",
  "eventsDomain",
  "reaction.origin",
  ".compute(",
  ".effect(",
  "join(",
  "execution.agent(",
  "execution.dataset(",
  "fromContext(",
  "event_contexts",
  "event_items",
  "event_executions",
  "event_steps",
  "event_points",
]) {
  if (activeApiCorpus.includes(forbidden)) {
    throw new Error(`reactor_docs_legacy_surface:${forbidden}`)
  }
}

console.log(`Verified ${requiredPages.length} Reactor docs pages and ${evidenceEntries.length} source/test links.`)

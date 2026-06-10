import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buildRegistriesConfig, getDomainRegistryById } from "@/lib/domain-registries";

export const metadata = {
  title: "@ekairos-events | Ekairos Registry",
  description:
    "The events registry: installable UI for durable AI interactions — context panels, agent shells, renderers, and prompt primitives.",
};

const STORY = [
  {
    step: "context",
    body: "A durable interaction starts as an event_context: narrative, skills, actions, model, reactor.",
  },
  {
    step: "turns",
    body: "User and assistant items accumulate as event_items — the conversation is state, not transport.",
  },
  {
    step: "executions",
    body: "Each reaction run is an event_execution with steps for reasoning, action calls, and progress.",
  },
  {
    step: "parts",
    body: "event_parts is the canonical replay surface. Everything the UI renders comes from here.",
  },
] as const;

export default function EventsRegistryPage() {
  const registry = getDomainRegistryById("events");
  if (!registry) {
    return null;
  }

  return (
    <main className="min-h-[calc(100svh-56px)] bg-background text-foreground">
      <section className="bg-black text-white">
        <div className="mx-auto w-full max-w-[88rem] px-4 py-14 md:px-8 md:py-20">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#61e9ff]">
            <Link href="/registries" className="transition-colors hover:text-white">
              registries
            </Link>{" "}
            / events
          </p>
          <div className="mt-6 grid gap-10 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="min-w-0">
              <h1 className="font-mono text-4xl font-semibold leading-tight md:text-6xl">
                {registry.namespace}
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-white/70 md:text-lg">
                The interaction layer, installable. Every component on this page renders
                live context state from <span className="font-mono text-[#61e9ff]">{registry.schemaPackage}</span>{" "}
                — the registry ships presentation, the package keeps the durable runtime.
              </p>
              <div className="mt-8 flex flex-wrap gap-4 font-mono text-xs">
                <a
                  href={registry.manifestPath}
                  className="border border-[#61e9ff]/40 bg-[#61e9ff]/10 px-3 py-2 text-white transition-colors hover:bg-[#61e9ff]/20"
                >
                  {registry.manifestPath}
                </a>
                <span className="border border-white/15 px-3 py-2 text-white/60">
                  {registry.publishedCount} published · {registry.sourceCount} source
                </span>
              </div>
            </div>
            <div className="grid min-w-0 content-start border-y border-white/15">
              {STORY.map((entry) => (
                <div
                  key={entry.step}
                  className="grid gap-2 border-b border-white/15 py-4 last:border-b-0 md:grid-cols-[7rem_minmax(0,1fr)]"
                >
                  <span className="font-mono text-xs uppercase tracking-[0.22em] text-[#61e9ff]">
                    {entry.step}
                  </span>
                  <p className="text-sm leading-6 text-white/65">{entry.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-[88rem] gap-8 px-4 py-10 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:px-8">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              setup
            </p>
            <h2 className="mt-4 max-w-md text-2xl font-semibold leading-tight">
              One namespace. The whole agent surface.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              Register <span className="font-mono text-foreground">{registry.namespace}</span> once
              in components.json. Items install into your tree and import runtime behavior from{" "}
              <span className="font-mono text-foreground">{registry.packageDependency}</span>.
            </p>
          </div>
          <div className="grid min-w-0 content-start gap-4">
            <pre className="overflow-x-auto bg-muted/45 p-4 font-mono text-xs leading-6">
              <code>{buildRegistriesConfig([registry])}</code>
            </pre>
            <pre className="overflow-x-auto bg-muted/45 p-4 font-mono text-xs leading-6">
              <code>{`pnpm dlx shadcn@latest add ${registry.namespace}/event-context-panel`}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-[88rem] gap-10 px-4 py-10 md:grid-cols-[15rem_minmax(0,1fr)] md:px-8">
        <aside className="min-w-0 md:sticky md:top-20 md:self-start">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            catalog
          </p>
          <nav className="mt-4 grid gap-5">
            {registry.groups.map((group) => (
              <div key={group.name}>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {group.name}
                </p>
                <ul className="mt-2 grid gap-1.5">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.registryName}`}
                        className="flex items-center justify-between gap-2 transition-colors hover:text-muted-foreground"
                      >
                        <span className="truncate font-mono text-xs">{item.registryName}</span>
                        {item.status === "published" ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#0891b2]" />
                        ) : null}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">
          {registry.groups.map((group) => (
            <div key={group.name} className="border-b border-border py-8 first:pt-0 last:border-b-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                {group.name}
              </p>
              <div className="mt-2 grid">
                {group.items.map((item) => (
                  <article
                    key={item.id}
                    id={item.registryName}
                    className="scroll-mt-24 border-t border-border py-6 first:border-t-0"
                  >
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-lg font-semibold">
                            <Link
                              href={`/registry/${item.registryName}`}
                              className="transition-colors hover:text-muted-foreground"
                            >
                              {item.label}
                            </Link>
                          </h3>
                          <span
                            className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
                              item.status === "published"
                                ? "border-[#0891b2] text-[#0891b2]"
                                : "border-border text-muted-foreground"
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                          {item.description}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                          <span>{item.packageImport}</span>
                          <span>{item.target}</span>
                        </div>
                        {item.status === "published" ? (
                          <pre className="mt-4 overflow-x-auto bg-muted/45 p-3 font-mono text-xs leading-6">
                            <code>{`pnpm dlx shadcn@latest add ${registry.namespace}/${item.registryName}`}</code>
                          </pre>
                        ) : (
                          <p className="mt-4 font-mono text-[11px] text-muted-foreground">
                            source in repo · not yet published to the registry endpoint
                          </p>
                        )}
                      </div>
                      <div className="grid content-start gap-2 font-mono text-xs md:text-right">
                        {item.status === "published" ? (
                          <a
                            href={`/r/${registry.id}/${item.registryName}.json`}
                            className="text-foreground underline underline-offset-4"
                          >
                            /r/{registry.id}/{item.registryName}.json
                          </a>
                        ) : null}
                        <Link
                          href={item.href}
                          className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                        >
                          component surface
                        </Link>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-black text-white">
        <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-6 px-4 py-12 md:flex-row md:items-center md:justify-between md:px-8">
          <p className="max-w-2xl text-2xl font-semibold leading-tight md:text-3xl">
            Install the surface. The context, the turns, and the replay stay in the package.
          </p>
          <Link
            href={registry.domain.href}
            className="inline-flex w-fit items-center gap-2 border border-[#61e9ff]/40 px-4 py-3 font-mono text-xs uppercase tracking-[0.2em] text-white transition-colors hover:bg-[#61e9ff]/15"
          >
            events domain
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}

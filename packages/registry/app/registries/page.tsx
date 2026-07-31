import Link from "next/link";

import { buildRegistriesConfig, domainRegistries } from "@/lib/domain-registries";

export const metadata = {
  title: "Registries | Ekairos Registry",
  description:
    "One shadcn-compatible registry per Ekairos domain: namespaced items, per-domain manifests, and package-backed runtime dependencies.",
};

const DOMAIN_ACCENTS: Record<string, string> = {
  events: "#0891b2",
  channel: "#0e7490",
  sandbox: "#3fae5a",
  dataset: "#b45309",
  task: "#b91c1c",
};

export default function RegistriesPage() {
  return (
    <main className="mx-auto min-h-[calc(100svh-56px)] w-full max-w-[88rem] px-4 py-8 md:px-8 md:py-12">
      <header className="grid gap-8 border-b border-border pb-8 md:grid-cols-[minmax(0,0.86fr)_minmax(16rem,0.36fr)]">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            registries
          </p>
          <h1 className="mt-4 max-w-4xl text-3xl font-semibold leading-tight md:text-5xl">
            One registry per domain.
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
            Each Ekairos domain publishes its own shadcn-compatible registry. Items install
            under the domain namespace, the manifest lives at a per-domain URL, and runtime
            behavior stays in the domain package.
          </p>
        </div>
        <div className="grid content-start gap-3 border-t border-border pt-5 font-mono text-xs text-muted-foreground md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <span>@ekairos-&lt;domain&gt;</span>
          <span>/r/&lt;domain&gt;/registry.json</span>
          <span>/r/&lt;domain&gt;/&lt;item&gt;.json</span>
          <span>registry:component</span>
        </div>
      </header>

      <section className="grid gap-8 border-b border-border py-8 md:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            configure once
          </p>
          <h2 className="mt-4 max-w-md text-2xl font-semibold leading-tight">
            Add the domain namespaces to components.json.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
            After the registries are configured, every item installs by namespace:
            <span className="ml-1 font-mono text-foreground">
              npx shadcn@latest add http://localhost:3030/r/event-timeline.json
            </span>
            .
          </p>
        </div>
        <pre className="min-w-0 overflow-x-auto bg-muted/45 p-4 font-mono text-xs leading-6">
          <code>{buildRegistriesConfig()}</code>
        </pre>
      </section>

      <section className="py-8">
        <div className="border-y border-border">
          {domainRegistries.map((registry) => (
            <div key={registry.id} className="border-b border-border py-6 last:border-b-0">
              <div className="grid gap-5 md:grid-cols-[16rem_minmax(0,1fr)_minmax(0,16rem)]">
                <Link href={`/registries/${registry.id}`} className="group min-w-0">
                  <span
                    className="font-mono text-sm"
                    style={{ color: DOMAIN_ACCENTS[registry.id] }}
                  >
                    {registry.namespace}
                  </span>
                  <span className="mt-2 block text-2xl font-semibold leading-tight transition-colors group-hover:text-muted-foreground">
                    {registry.title}
                  </span>
                  <span className="mt-3 block font-mono text-xs text-muted-foreground">
                    {registry.packageDependency}
                  </span>
                </Link>

                <div className="min-w-0">
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                    {registry.summary}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {registry.items.length > 0 ? (
                      registry.groups.map((group) => (
                        <span
                          key={group.name}
                          className="border border-border px-2.5 py-1 font-mono text-xs text-foreground"
                        >
                          {group.name} · {group.items.length}
                        </span>
                      ))
                    ) : (
                      <span className="border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground">
                        showcase-first
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid content-start gap-2 font-mono text-xs md:text-right">
                  <span className="text-muted-foreground">
                    {registry.publishedCount} published · {registry.sourceCount} source
                  </span>
                  <a
                    href={registry.manifestPath}
                    className="text-foreground underline underline-offset-4"
                  >
                    {registry.manifestPath}
                  </a>
                  <Link
                    href={`/registries/${registry.id}`}
                    className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                  >
                    browse registry
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

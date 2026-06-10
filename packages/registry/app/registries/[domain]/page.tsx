import Link from "next/link";
import { notFound } from "next/navigation";

import {
  buildRegistriesConfig,
  domainRegistries,
  getDomainRegistryById,
} from "@/lib/domain-registries";

type DomainRegistryPageProps = {
  params: Promise<{ domain: string }>;
};

export function generateStaticParams() {
  return domainRegistries.map((registry) => ({ domain: registry.id }));
}

export async function generateMetadata({ params }: DomainRegistryPageProps) {
  const { domain } = await params;
  const registry = getDomainRegistryById(domain);
  if (!registry) {
    return { title: "Registry not found | Ekairos Registry" };
  }
  return {
    title: `${registry.namespace} | Ekairos Registry`,
    description: registry.summary,
  };
}

export default async function DomainRegistryPage({ params }: DomainRegistryPageProps) {
  const { domain } = await params;
  const registry = getDomainRegistryById(domain);

  if (!registry) {
    notFound();
  }

  return (
    <main className="mx-auto min-h-[calc(100svh-56px)] w-full max-w-[88rem] px-4 py-8 md:px-8 md:py-12">
      <header className="grid gap-8 border-b border-border pb-8 md:grid-cols-[minmax(0,0.86fr)_minmax(16rem,0.36fr)]">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            <Link href="/registries" className="transition-colors hover:text-foreground">
              registries
            </Link>{" "}
            / {registry.id}
          </p>
          <h1 className="mt-4 max-w-4xl font-mono text-3xl font-semibold leading-tight md:text-5xl">
            {registry.namespace}
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
            {registry.summary}
          </p>
        </div>
        <div className="grid content-start gap-3 border-t border-border pt-5 font-mono text-xs md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <a
            href={registry.manifestPath}
            className="text-foreground underline underline-offset-4"
          >
            {registry.manifestPath}
          </a>
          <span className="text-muted-foreground">{registry.packageDependency}</span>
          <span className="text-muted-foreground">
            {registry.publishedCount} published · {registry.sourceCount} source
          </span>
          <Link
            href={registry.domain.href}
            className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
          >
            open domain
          </Link>
        </div>
      </header>

      <div className="grid gap-10 py-8 md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="min-w-0 md:sticky md:top-20 md:self-start">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            items
          </p>
          {registry.groups.length > 0 ? (
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
                          className="flex items-center justify-between gap-2 text-sm text-foreground transition-colors hover:text-muted-foreground"
                        >
                          <span className="truncate font-mono text-xs">
                            {item.registryName}
                          </span>
                          {item.status === "published" ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />
                          ) : null}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          ) : (
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              No items yet. The domain surface is iterating publicly before the first
              item lands in this registry.
            </p>
          )}
        </aside>

        <div className="min-w-0">
          <section className="border-b border-border pb-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              setup
            </p>
            <div className="mt-4 grid gap-4">
              <pre className="overflow-x-auto bg-muted/45 p-4 font-mono text-xs leading-6">
                <code>{buildRegistriesConfig([registry])}</code>
              </pre>
              <pre className="overflow-x-auto bg-muted/45 p-4 font-mono text-xs leading-6">
                <code>{`pnpm dlx shadcn@latest add ${registry.namespace}/<item>`}</code>
              </pre>
            </div>
          </section>

          {registry.items.length > 0 ? (
            <section className="grid">
              {registry.groups.map((group) => (
                <div key={group.name} className="border-b border-border py-8 last:border-b-0">
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
                              <h2 className="text-lg font-semibold">
                                <Link
                                  href={`/registry/${item.registryName}`}
                                  className="transition-colors hover:text-muted-foreground"
                                >
                                  {item.label}
                                </Link>
                              </h2>
                              <span
                                className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
                                  item.status === "published"
                                    ? "border-foreground text-foreground"
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
            </section>
          ) : (
            <section className="py-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                backlog
              </p>
              <ul className="mt-4 grid gap-3">
                {registry.domain.componentBacklog.map((entry) => (
                  <li
                    key={entry}
                    className="border-t border-border pt-3 text-sm leading-6 text-muted-foreground first:border-t-0"
                  >
                    {entry}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Link
                  href={registry.domain.componentsHref}
                  className="border border-border px-3 py-2 font-mono text-xs text-foreground transition-colors hover:bg-muted/50"
                >
                  {registry.domain.componentsHref}
                </Link>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

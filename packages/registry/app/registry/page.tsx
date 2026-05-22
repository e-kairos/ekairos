import Link from "next/link";

import { domainRegistry } from "@/lib/domain-registry";

export default function RegistryListPage() {
  return (
    <main className="mx-auto min-h-[calc(100svh-56px)] w-full max-w-[88rem] px-4 py-8 md:px-8 md:py-12">
      <header className="grid gap-8 border-b border-border pb-8 md:grid-cols-[minmax(0,0.86fr)_minmax(16rem,0.36fr)]">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            manifest
          </p>
          <h1 className="mt-4 max-w-4xl text-3xl font-semibold leading-tight md:text-5xl">
            Installable components by domain.
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
            The registry publishes UI primitives grouped by domain. Each component installs from
            its `/r/*.json` endpoint and imports runtime behavior from the domain package.
          </p>
        </div>
        <div className="grid content-start gap-3 border-t border-border pt-5 font-mono text-xs text-muted-foreground md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <span>{domainRegistry.length} domains</span>
          <span>{domainRegistry.flatMap((domain) => domain.components).length} components</span>
          <span>registry:component</span>
        </div>
      </header>

      <section className="py-8">
        <div className="border-y border-border">
          {domainRegistry.map((domain) => (
            <div key={domain.id} className="border-b border-border py-5 last:border-b-0">
              <div className="grid gap-5 md:grid-cols-[14rem_minmax(0,1fr)]">
                <Link href={domain.href} className="group min-w-0">
                  <span className="font-mono text-sm text-foreground">/{domain.id}</span>
                  <span className="mt-2 block text-2xl font-semibold leading-tight transition-colors group-hover:text-muted-foreground">
                    {domain.title}
                  </span>
                  <span className="mt-3 block text-sm leading-6 text-muted-foreground">
                    {domain.packageDependency}
                  </span>
                </Link>
                <div className="grid gap-3">
                  {domain.components.map((component) => (
                    <div
                      key={component.id}
                      className="grid gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,1fr)_17rem]"
                    >
                      <div>
                        <h2 className="text-lg font-semibold">
                          <Link
                            href={`/registry/${component.registryName}`}
                            className="transition-colors hover:text-muted-foreground"
                          >
                            {component.label}
                          </Link>
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {component.description}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] text-muted-foreground">
                          <span>{component.packageImport}</span>
                          <span>{component.target}</span>
                        </div>
                      </div>
                      <a
                        href={component.registryPath}
                        className="font-mono text-xs text-foreground underline underline-offset-4 md:text-right"
                      >
                        {component.registryPath}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

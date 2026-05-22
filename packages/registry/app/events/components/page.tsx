import Link from "next/link";

import { getRegistry } from "@/app/[component]/route";
import { eventsDomainEntry } from "@/lib/domain-registry";

export const revalidate = 3600;

const installCommand = (registryName: string) =>
  `pnpm dlx shadcn@4.8.0 add https://registry.ekairos.dev/r/${registryName}.json`;
const localInstallCommand = (registryName: string) =>
  `pnpm dlx shadcn@4.8.0 add http://localhost:3030/r/${registryName}.json`;

export default async function EventsComponentsPage() {
  const registry = await getRegistry();
  const publishedItems = new Map(registry.items.map((item) => [item.name, item]));
  const primaryComponent = eventsDomainEntry.components[0];
  const primaryItem = primaryComponent
    ? publishedItems.get(primaryComponent.registryName)
    : null;
  const primaryDependency =
    primaryItem?.dependencies?.[0] ??
    primaryComponent?.dependency ??
    eventsDomainEntry.packageDependency;

  return (
    <main className="min-h-[calc(100svh-56px)] bg-background text-foreground">
      <section className="mx-auto grid w-full max-w-[88rem] gap-8 px-4 py-8 md:grid-cols-[15rem_minmax(0,1fr)] md:px-8 md:py-12">
        <aside className="border-y border-border py-5 md:border-y-0 md:border-r md:pr-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            domain
          </p>
          <div className="mt-5 grid gap-4 text-sm">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                package
              </p>
              <p className="mt-1 font-mono">{eventsDomainEntry.packageDependency}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                aggregate
              </p>
              <p className="mt-1 font-mono">{eventsDomainEntry.aggregateRoot}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                durable
              </p>
              <p className="mt-1 font-mono">{eventsDomainEntry.durableSurface}</p>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="grid gap-6 border-b border-border pb-8">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                {eventsDomainEntry.schemaPackage}
              </p>
              <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">
                Events components.
              </h1>
              <p className="mt-5 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
                Components for rendering and operating `event_contexts` in product apps. The
                registry installs UI files; the hook and runtime model come from the
                `@ekairos/events` package.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/docs/domains/events"
                  className="border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  Domain notes
                </Link>
                {primaryComponent ? (
                  <a
                    href={primaryComponent.registryPath}
                    className="border border-foreground bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
                  >
                    Open manifest
                  </a>
                ) : null}
              </div>
            </div>

            {primaryComponent ? (
              <aside className="border-t border-border pt-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                  install primary
                </p>
                <pre className="mt-4 whitespace-pre-wrap break-all bg-muted/45 p-4 text-[10px] leading-6">
                  <code>{installCommand(primaryComponent.registryName)}</code>
                </pre>
                <dl className="mt-5 grid gap-3 text-sm">
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      registry
                    </dt>
                    <dd className="mt-1 font-mono">{primaryComponent.registryPath}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      dependency
                    </dt>
                    <dd className="mt-1 font-mono">{primaryDependency}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      shadcn cli
                    </dt>
                    <dd className="mt-1 font-mono">4.8.0</dd>
                  </div>
                </dl>
              </aside>
            ) : null}
          </header>

          <section className="py-8">
            <div className="grid border-y border-border font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground md:grid-cols-[12rem_minmax(0,1fr)_24rem]">
              <div className="border-b border-border py-3 md:border-b-0 md:border-r md:pr-4">
                Component
              </div>
              <div className="border-b border-border py-3 md:border-b-0 md:border-r md:px-4">
                Contract
              </div>
              <div className="py-3 md:pl-4">Install</div>
            </div>

            <div className="border-b border-border">
              {eventsDomainEntry.components.map((component) => (
                <article
                  key={component.id}
                  id={component.id}
                  className="grid gap-4 border-t border-border py-5 md:grid-cols-[12rem_minmax(0,1fr)_24rem]"
                >
                  <div className="md:border-r md:pr-4">
                    <h2 className="text-xl font-semibold">{component.label}</h2>
                    <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      {component.status}
                    </p>
                  </div>
                  <div className="min-w-0 md:border-r md:px-4">
                    <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                      {component.description}
                    </p>
                    <div className="mt-4 grid gap-2 font-mono text-xs text-muted-foreground">
                      <span>target: {component.target}</span>
                      <span>type: registry:component</span>
                      <span>dependency: {component.dependency}</span>
                      <span>package import: {component.packageImport}</span>
                    </div>
                  </div>
                  <div className="grid content-start gap-3 md:pl-4">
                    <a
                      href={component.registryPath}
                      className="font-mono text-xs text-foreground underline underline-offset-4"
                    >
                      {component.registryPath}
                    </a>
                    <pre className="whitespace-pre-wrap break-all bg-muted/45 p-3 text-[10px] leading-5">
                      <code>{installCommand(component.registryName)}</code>
                    </pre>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {primaryComponent ? (
            <section className="grid gap-8 border-t border-border py-8 md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                  local iteration
                </p>
                <h2 className="mt-3 text-2xl font-semibold leading-tight">
                  Registry and template use the same package contract.
                </h2>
              </div>
              <div className="grid gap-4 text-sm leading-6 text-muted-foreground">
                <p>
                  `--template=agent` includes the registry alias and the `@ekairos/events`
                  dependency. Installed components import from that package directly; no
                  runtime adapter is copied into the app.
                </p>
                <pre className="whitespace-pre-wrap break-all bg-muted/45 p-4 text-xs leading-6 text-foreground">
                  <code>{localInstallCommand(primaryComponent.registryName)}</code>
                </pre>
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}

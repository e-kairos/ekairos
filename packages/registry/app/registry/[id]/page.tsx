import Link from "next/link";
import { notFound } from "next/navigation";

import { domainRegistry } from "@/lib/domain-registry";

type RegistryComponentPageProps = {
  params: Promise<{ id: string }>;
};

export default async function RegistryComponentPage({
  params,
}: {
  params: RegistryComponentPageProps["params"];
}) {
  const { id } = await params;
  const match = domainRegistry
    .flatMap((domain) =>
      domain.components.map((component) => ({
        domain,
        component,
      })),
    )
    .find(({ component }) => component.registryName === id || component.id === id);

  if (!match) {
    notFound();
  }

  const { domain, component } = match;
  const installCommand = `pnpm dlx shadcn@4.8.0 add https://registry.ekairos.dev${component.registryPath}`;

  return (
    <main className="mx-auto min-h-[calc(100svh-56px)] w-full max-w-[72rem] px-4 py-8 md:px-8 md:py-12">
      <header className="grid gap-6 border-b border-border pb-8 md:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            /{domain.id} registry component
          </p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight md:text-5xl">
            {component.label}
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
            {component.description}
          </p>
        </div>
        <div className="grid content-start gap-3 border-t border-border pt-5 font-mono text-xs md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <span>{component.registryPath}</span>
          <span>{component.dependency}</span>
          <span>{component.packageImport}</span>
        </div>
      </header>

      <section className="grid gap-8 py-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            domain contract
          </p>
          <dl className="mt-5 grid gap-3 text-sm">
            <div className="border-t border-border pt-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                schema
              </dt>
              <dd className="mt-1 font-mono">{domain.schemaPackage}</dd>
            </div>
            <div className="border-t border-border pt-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                aggregate
              </dt>
              <dd className="mt-1 font-mono">{domain.aggregateRoot}</dd>
            </div>
            <div className="border-t border-border pt-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                durable surface
              </dt>
              <dd className="mt-1 font-mono">{domain.durableSurface}</dd>
            </div>
          </dl>
        </div>

        <div className="grid content-start gap-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              install
            </p>
            <pre className="mt-4 whitespace-pre-wrap break-all bg-muted/45 p-4 text-xs leading-6">
              <code>{installCommand}</code>
            </pre>
          </div>
          <div className="grid gap-3 border-t border-border pt-5 text-sm leading-6 text-muted-foreground">
            <p>
              The registry installs the UI file at{" "}
              <span className="font-mono text-foreground">{component.target}</span>.
              Runtime behavior stays in the domain package dependency.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href={domain.href}
                className="border border-foreground bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Open domain
              </Link>
              <a
                href={component.registryPath}
                className="border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/50"
              >
                Open JSON
              </a>
              <Link
                href="/registry"
                className="border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                Manifest index
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

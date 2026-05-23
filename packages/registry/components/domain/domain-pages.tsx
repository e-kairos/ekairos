import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Braces, Boxes, Library, Route, TerminalSquare } from "lucide-react";

import type { DomainRegistryEntry } from "@/lib/domain-registry";

type DomainPageMode = "overview" | "components" | "domain";

const installCommand = (registryName: string) =>
  `pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/${registryName}.json`;

const localInstallCommand = (registryName: string) =>
  `pnpm dlx shadcn@latest add http://localhost:3030/r/${registryName}.json`;

export function DomainLandingPage({ domain }: { domain: DomainRegistryEntry }) {
  return (
    <main className="min-h-[calc(100svh-56px)] bg-background text-foreground">
      <section className="bg-black text-white">
        <div className="mx-auto w-full max-w-[94rem] px-5 py-8 md:px-10 lg:px-14">
          <DomainNav domain={domain} active="overview" tone="dark" />

          <div className="grid min-h-[calc(100svh-12rem)] items-center gap-10 py-12 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:py-16">
            <header className="min-w-0">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.32em] text-red-500">
                {domain.heroLabel}
              </p>
              <h1 className="mt-5 max-w-4xl text-balance text-5xl font-semibold leading-[0.92] md:text-7xl lg:text-8xl">
                {domain.heroTitle}
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-7 text-white/66 md:text-lg md:leading-8">
                {domain.heroBody}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={domain.componentsHref}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-black transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-white/90"
                >
                  Components
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href={domain.domainHref}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/18 px-4 py-2 text-sm font-semibold text-white transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-white/10"
                >
                  Domain library
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </header>

            <DomainShowcase domain={domain} />
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-[#f4f6f7]">
        <div className="mx-auto grid w-full max-w-[94rem] gap-10 px-5 py-14 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] md:px-10 md:py-20 lg:px-14">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-red-700">
              Route contract
            </p>
            <h2 className="mt-5 max-w-xl text-4xl font-semibold leading-[0.95] md:text-6xl">
              Landing, UI, and library are separate surfaces.
            </h2>
          </div>
          <div className="grid min-w-0 border-t border-black/20 md:grid-cols-3 md:border-l md:border-t-0">
            {domain.routes.map((route, index) => (
              <Link
                key={route.href}
                href={route.href}
                className="group border-b border-black/20 py-7 md:border-b-0 md:border-r md:px-7 md:last:border-r-0"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs uppercase tracking-[0.24em] text-red-700">
                    0{index + 1}
                  </span>
                  <span className="h-px min-w-8 flex-1 bg-black/20 transition-colors group-hover:bg-black" />
                </div>
                <p className="mt-8 font-mono text-sm text-foreground">{route.label}</p>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  {route.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-background">
        <div className="mx-auto grid w-full max-w-[94rem] gap-10 px-5 py-14 md:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] md:px-10 md:py-20 lg:px-14">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-red-700">
              Runtime shape
            </p>
            <h2 className="mt-5 max-w-xl text-4xl font-semibold leading-[0.95] md:text-6xl">
              Package behavior. Registry presentation.
            </h2>
            <p className="mt-6 max-w-xl text-sm leading-6 text-muted-foreground">
              {domain.componentSurface}
            </p>
          </div>

          <div className="min-w-0 border-y border-border">
            <DomainFactRow label="package" value={domain.packageDependency} />
            <DomainFactRow label="aggregate" value={domain.aggregateRoot} />
            <DomainFactRow label="durable" value={domain.durableSurface} />
            <DomainFactRow
              label="ui"
              value={
                domain.components.length > 0
                  ? `${domain.components.length} published component`
                  : "component surface reserved"
              }
            />
          </div>
        </div>
      </section>
    </main>
  );
}

export function DomainComponentsPage({ domain }: { domain: DomainRegistryEntry }) {
  return (
    <main className="min-h-[calc(100svh-56px)] bg-background text-foreground">
      <section className="bg-black text-white">
        <div className="mx-auto w-full max-w-[94rem] px-5 py-8 md:px-10 lg:px-14">
          <DomainNav domain={domain} active="components" tone="dark" />
          <header className="grid gap-8 py-12 md:grid-cols-[minmax(0,0.92fr)_minmax(18rem,0.38fr)] md:py-16">
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-red-500">
                {domain.schemaPackage}
              </p>
              <h1 className="mt-5 max-w-4xl text-5xl font-semibold leading-[0.92] md:text-7xl">
                {domain.title} UI components.
              </h1>
              <p className="mt-6 max-w-3xl text-base leading-7 text-white/65">
                {domain.componentSurface}
              </p>
            </div>
            <div className="grid content-start gap-3 border-t border-white/18 pt-5 font-mono text-xs text-white/62 md:border-l md:border-t-0 md:pl-5 md:pt-0">
              <span>{domain.packageDependency}</span>
              <span>{domain.aggregateRoot}</span>
              <span>{domain.durableSurface}</span>
            </div>
          </header>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[94rem] px-5 py-10 md:px-10 md:py-14 lg:px-14">
        {domain.components.length > 0 ? (
          <div className="border-y border-border">
            <div className="grid border-b border-border font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground md:grid-cols-[14rem_minmax(0,1fr)_24rem]">
              <div className="py-3 md:border-r md:pr-4">Component</div>
              <div className="border-t border-border py-3 md:border-l-0 md:border-t-0 md:px-4">
                Contract
              </div>
              <div className="border-t border-border py-3 md:border-l md:border-t-0 md:pl-4">
                Install
              </div>
            </div>
            {domain.components.map((component) => (
              <article
                key={component.id}
                id={component.id}
                className="grid gap-5 border-b border-border py-6 last:border-b-0 md:grid-cols-[14rem_minmax(0,1fr)_24rem]"
              >
                <div className="md:border-r md:pr-4">
                  <h2 className="text-2xl font-semibold leading-tight">{component.label}</h2>
                  <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-red-700">
                    {component.status}
                  </p>
                </div>
                <div className="min-w-0 md:px-4">
                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                    {component.description}
                  </p>
                  <div className="mt-5 grid gap-2 font-mono text-xs text-muted-foreground">
                    <span>target: {component.target}</span>
                    <span>type: registry:component</span>
                    <span>dependency: {component.dependency}</span>
                    <span>package import: {component.packageImport}</span>
                  </div>
                </div>
                <div className="grid content-start gap-3 md:border-l md:pl-4">
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
        ) : (
          <div className="grid gap-10 border-y border-border py-8 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-red-700">
                UI surface
              </p>
              <h2 className="mt-5 max-w-xl text-4xl font-semibold leading-[0.95] md:text-6xl">
                Showcase first. Registry second.
              </h2>
              <p className="mt-6 max-w-lg text-sm leading-6 text-muted-foreground">
                This domain has a public UI section before manifest publication, so primitives can
                be shaped against the real package contract instead of invented in isolation.
              </p>
            </div>
            <div className="grid content-start gap-4">
              {domain.componentBacklog.map((item, index) => (
                <div key={item} className="grid gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0 md:grid-cols-[5rem_minmax(0,1fr)]">
                  <span className="font-mono text-xs uppercase tracking-[0.24em] text-red-700">
                    0{index + 1}
                  </span>
                  <p className="text-sm leading-6 text-muted-foreground">{item}</p>
                </div>
              ))}
              <Link
                href={domain.href}
                className="mt-4 inline-flex min-h-10 w-fit items-center gap-2 border border-foreground bg-foreground px-4 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90"
              >
                Open {domain.title} landing
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        )}

        {domain.components.length > 0 ? (
          <section className="grid gap-8 border-b border-border py-10 md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                local iteration
              </p>
              <h2 className="mt-3 text-2xl font-semibold leading-tight">
                Registry and templates use the same package contract.
              </h2>
            </div>
            <div className="grid gap-4 text-sm leading-6 text-muted-foreground">
              <p>
                Installed components import behavior from{" "}
                <span className="font-mono text-foreground">{domain.schemaPackage}</span>.
                The registry only ships UI files and shadcn-compatible dependencies.
              </p>
              <pre className="whitespace-pre-wrap break-all bg-muted/45 p-4 text-xs leading-6 text-foreground">
                <code>{localInstallCommand(domain.components[0].registryName)}</code>
              </pre>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

export function DomainLibraryPage({ domain }: { domain: DomainRegistryEntry }) {
  return (
    <main className="min-h-[calc(100svh-56px)] bg-background text-foreground">
      <section className="border-b border-border bg-[#f4f6f7]">
        <div className="mx-auto w-full max-w-[94rem] px-5 py-8 md:px-10 lg:px-14">
          <DomainNav domain={domain} active="domain" tone="light" />
          <header className="grid gap-8 py-12 md:grid-cols-[minmax(0,0.9fr)_minmax(18rem,0.42fr)] md:py-16">
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-red-700">
                {domain.schemaPackage}
              </p>
              <h1 className="mt-5 max-w-4xl text-5xl font-semibold leading-[0.92] md:text-7xl">
                {domain.title} domain library.
              </h1>
              <p className="mt-6 max-w-3xl text-base leading-7 text-muted-foreground">
                {domain.summary}
              </p>
            </div>
            <div className="grid content-start gap-3 border-t border-black/20 pt-5 font-mono text-xs text-muted-foreground md:border-l md:border-t-0 md:pl-5 md:pt-0">
              <span>install {domain.packageDependency}</span>
              <span>root {domain.aggregateRoot}</span>
              <span>surface {domain.durableSurface}</span>
            </div>
          </header>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-[94rem] gap-10 px-5 py-10 md:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)] md:px-10 md:py-14 lg:px-14">
        <aside className="min-w-0">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-red-700">
            Library contract
          </p>
          <h2 className="mt-5 max-w-xl text-4xl font-semibold leading-[0.95]">
            Schema and actions define what UI is allowed to show.
          </h2>
          <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">
            {domain.usageBody}
          </p>
        </aside>

        <div className="min-w-0">
          <DomainDocSection icon={<Boxes className="h-4 w-4" />} title="Schema">
            {domain.schemaEntities.map((entity) => (
              <div key={entity.name} className="grid gap-3 border-t border-border py-4 first:border-t-0 first:pt-0 md:grid-cols-[13rem_minmax(0,1fr)]">
                <p className="font-mono text-xs text-foreground">{entity.name}</p>
                <p className="text-sm leading-6 text-muted-foreground">{entity.description}</p>
              </div>
            ))}
          </DomainDocSection>

          <DomainDocSection icon={<Braces className="h-4 w-4" />} title="Actions">
            {domain.actions.map((action) => (
              <div key={action.name} className="grid gap-3 border-t border-border py-4 first:border-t-0 first:pt-0 md:grid-cols-[13rem_minmax(0,1fr)]">
                <p className="font-mono text-xs text-foreground">{action.name}</p>
                <p className="text-sm leading-6 text-muted-foreground">{action.description}</p>
              </div>
            ))}
          </DomainDocSection>

          <DomainDocSection icon={<TerminalSquare className="h-4 w-4" />} title={domain.usageTitle}>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {domain.usageBody}
            </p>
            <pre className="mt-5 overflow-x-auto bg-black p-5 text-xs leading-6 text-white">
              <code>{domain.usageCode}</code>
            </pre>
          </DomainDocSection>
        </div>
      </section>
    </main>
  );
}

function DomainNav({
  domain,
  active,
  tone,
}: {
  domain: DomainRegistryEntry;
  active: DomainPageMode;
  tone: "dark" | "light";
}) {
  const items = [
    { id: "overview", label: domain.id, href: domain.href, icon: Route },
    { id: "components", label: "components", href: domain.componentsHref, icon: Boxes },
    { id: "domain", label: "domain", href: domain.domainHref, icon: Library },
  ] as const;

  return (
    <nav
      aria-label={`${domain.title} domain navigation`}
      className={tone === "dark" ? "border-y border-white/14" : "border-y border-black/20"}
    >
      <div className="flex min-w-0 gap-0 overflow-x-auto">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === active;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "flex min-h-11 shrink-0 items-center gap-2 border-r px-4 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors",
                tone === "dark" ? "border-white/14" : "border-black/20",
                isActive
                  ? tone === "dark"
                    ? "bg-white text-black"
                    : "bg-black text-white"
                  : tone === "dark"
                    ? "text-white/62 hover:bg-white/10 hover:text-white"
                    : "text-muted-foreground hover:bg-black/5 hover:text-foreground",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function DomainShowcase({ domain }: { domain: DomainRegistryEntry }) {
  const primaryComponent = domain.components[0];

  return (
    <div className="min-w-0 border border-white/14 bg-[#0b0b0c] shadow-[0_18px_80px_rgba(0,0,0,0.48)]">
      <div className="border-b border-white/14 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-red-500">
              /{domain.id}
            </p>
            <p className="mt-3 text-2xl font-semibold">{domain.title} surface</p>
          </div>
          <span className="w-fit rounded-md border border-white/12 px-3 py-1.5 font-mono text-xs text-white/58">
            {domain.packageDependency}
          </span>
        </div>
      </div>

      <div className="grid md:grid-cols-[0.9fr_1.1fr]">
        <div className="border-b border-white/14 p-5 md:border-b-0 md:border-r">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">
            schema
          </p>
          <div className="mt-5 grid gap-3">
            {domain.schemaEntities.slice(0, 4).map((entity) => (
              <div key={entity.name} className="border border-white/12 bg-white/[0.04] p-3">
                <p className="font-mono text-xs text-white">{entity.name}</p>
                <p className="mt-1 text-xs leading-5 text-white/48">{entity.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">
            actions
          </p>
          <div className="mt-5 grid gap-3">
            {domain.actions.slice(0, 4).map((action) => (
              <div key={action.name} className="flex gap-3 border border-white/12 p-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-600" />
                <div>
                  <p className="font-mono text-xs text-white">{action.name}</p>
                  <p className="mt-1 text-xs leading-5 text-white/52">{action.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 border border-white/12 bg-white/[0.04] p-4">
            <p className="font-semibold">
              {primaryComponent ? primaryComponent.label : "Showcase-first surface"}
            </p>
            <p className="mt-2 text-sm leading-6 text-white/58">
              {primaryComponent
                ? primaryComponent.description
                : "The route exists before registry publication so the public surface can be shaped against the real domain contract."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DomainFactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-3 border-b border-border py-5 last:border-b-0 md:grid-cols-[10rem_minmax(0,1fr)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p className="min-w-0 break-words font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

function DomainDocSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border py-7 first:border-t-0 first:pt-0">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center bg-black text-white">{icon}</span>
        <h2 className="text-2xl font-semibold leading-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

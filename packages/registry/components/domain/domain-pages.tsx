import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Braces, Boxes, Library, Route, TerminalSquare } from "lucide-react";

import {
  domainRegistry,
  type DomainRegistryComponentLink,
  type DomainRegistryEntry,
} from "@/lib/domain-registry";

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
                  ? `${domain.components.length} component listed`
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
  const sections = getDomainComponentSections(domain);
  const publishedComponent = domain.components.find(
    (component) => component.status === "published",
  );

  return (
    <main className="min-h-[calc(100svh-56px)] bg-[#fbfbfa] text-foreground">
      <div className="mx-auto grid w-full max-w-[96rem] gap-8 px-4 py-8 md:px-8 lg:grid-cols-[15rem_minmax(0,1fr)_15rem] lg:px-10">
        <aside className="hidden min-w-0 border-r border-border/70 pr-6 lg:block">
          <div className="sticky top-20 max-h-[calc(100svh-6rem)] overflow-y-auto py-8">
            <DomainComponentsSidebar domain={domain} sections={sections} />
          </div>
        </aside>

        <article className="min-w-0 py-8 lg:py-20">
          <header className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-sm text-muted-foreground">
                {domain.schemaPackage}
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
                {domain.title} Components
              </h1>
              <p className="mt-4 max-w-2xl text-xl leading-8 text-muted-foreground">
                {domain.componentSurface}
              </p>
            </div>

            {publishedComponent ? (
              <a
                href={publishedComponent.registryPath}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
              >
                Manifest
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : null}
          </header>

          <p className="mt-12 max-w-3xl text-base leading-8">
            Installable components stay small and package-backed. Product apps compose
            them with local routing, permissions, and domain copy without forking the
            registry source.
          </p>

          <div className="mt-12 grid gap-12">
            {sections.map((section) => (
              <section key={section.title} className="scroll-mt-24" id={section.id}>
                <h2 className="mb-6 text-sm font-medium text-muted-foreground">
                  {section.title}
                </h2>
                <div className="grid gap-x-16 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
                  {section.items.map((component) => (
                    <div key={component.id} id={component.id} className="scroll-mt-24">
                      <Link
                        href={component.href}
                        className="group inline-flex items-center gap-2 text-base font-medium underline decoration-foreground/80 decoration-2 underline-offset-4 transition-colors hover:text-red-700"
                      >
                        {component.label}
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground no-underline group-hover:text-red-700">
                          {component.status}
                        </span>
                      </Link>
                      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                        {component.description}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </article>

        <aside className="hidden min-w-0 py-20 xl:block">
          <div className="sticky top-20 grid gap-4">
            <section className="rounded-lg bg-[#f2f3f2] p-4">
              <h2 className="text-base font-semibold">Use in clients</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Registry components are the upstream UI surface for Workbench,
                templates, and product apps.
              </p>
              {publishedComponent ? (
                <pre className="mt-4 whitespace-pre-wrap break-all rounded-md bg-background p-3 text-[10px] leading-5">
                  <code>{installCommand(publishedComponent.registryName)}</code>
                </pre>
              ) : (
                <Link
                  href={domain.domainHref}
                  className="mt-4 inline-flex text-sm font-medium underline decoration-2 underline-offset-4"
                >
                  Open domain library
                </Link>
              )}
            </section>
            {publishedComponent ? (
              <section className="rounded-lg bg-[#f2f3f2] p-4">
                <h2 className="text-base font-semibold">Local install</h2>
                <pre className="mt-3 whitespace-pre-wrap break-all rounded-md bg-background p-3 text-[10px] leading-5">
                  <code>{localInstallCommand(publishedComponent.registryName)}</code>
                </pre>
              </section>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}

type DomainComponentListItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  status: DomainRegistryComponentLink["status"] | "planned";
  group: string;
};

type DomainComponentSection = {
  id: string;
  title: string;
  items: DomainComponentListItem[];
};

function getDomainComponentSections(domain: DomainRegistryEntry): DomainComponentSection[] {
  const sections = new Map<string, DomainComponentListItem[]>();

  for (const component of domain.components) {
    const group = component.group || "Components";
    const items = sections.get(group) ?? [];
    items.push({
      id: component.id,
      label: component.label,
      description: component.description,
      href: component.href,
      status: component.status,
      group,
    });
    sections.set(group, items);
  }

  if (domain.componentBacklog.length > 0) {
    sections.set(
      "Planned",
      domain.componentBacklog.map((item, index) => ({
        id: `${domain.id}-planned-${index + 1}`,
        label: item,
        description:
          "Planned domain primitive. It should be shaped in the public route before publication.",
        href: `${domain.componentsHref}#${domain.id}-planned-${index + 1}`,
        status: "planned",
        group: "Planned",
      })),
    );
  }

  return [...sections.entries()].map(([title, items]) => ({
    id: slugify(title),
    title,
    items,
  }));
}

function DomainComponentsSidebar({
  domain,
  sections,
}: {
  domain: DomainRegistryEntry;
  sections: DomainComponentSection[];
}) {
  return (
    <nav aria-label={`${domain.title} components navigation`} className="text-sm">
      <div>
        <p className="mb-3 text-xs text-muted-foreground">Getting Started</p>
        <div className="grid gap-1">
          <SidebarLink href={domain.href} active={false}>
            {domain.title}
          </SidebarLink>
          <SidebarLink href={domain.componentsHref} active>
            Components
          </SidebarLink>
          <SidebarLink href={domain.domainHref} active={false}>
            Domain
          </SidebarLink>
        </div>
      </div>

      <div className="mt-8">
        <p className="mb-3 text-xs text-muted-foreground">Domains</p>
        <div className="grid gap-1">
          {domainRegistry.map((item) => (
            <SidebarLink
              key={item.id}
              href={item.componentsHref}
              active={item.id === domain.id}
            >
              {item.title}
            </SidebarLink>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-7">
        {sections.map((section) => (
          <div key={section.id}>
            <p className="mb-3 text-xs text-muted-foreground">{section.title}</p>
            <div className="grid gap-2">
              {section.items.map((component) => (
                <a
                  key={component.id}
                  href={`#${component.id}`}
                  className="leading-5 text-foreground transition-colors hover:text-red-700"
                >
                  {component.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

function SidebarLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      className={[
        "w-fit rounded-md px-2 py-1 transition-colors",
        active ? "bg-muted text-foreground" : "text-foreground hover:bg-muted",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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

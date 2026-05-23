import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { domainRegistry } from "@/lib/domain-registry";

export const revalidate = 3600;

const LOOP_STEPS = [
  {
    label: "Showcase",
    title: "Shape the surface",
    body: "Start from the public domain screen until the interaction is right.",
  },
  {
    label: "Component",
    title: "Extract the primitive",
    body: "Move only the reusable UI into the component boundary.",
  },
  {
    label: "Registry",
    title: "Install it downstream",
    body: "Workbench, templates, and apps receive the same domain component.",
  },
] as const;

export default function HomePage() {
  const primaryDomain = domainRegistry[0];
  const primaryComponent = primaryDomain?.components[0];

  return (
    <main className="min-h-[calc(100svh-56px)] bg-background text-foreground">
      <section className="relative isolate min-h-[calc(100svh-56px)] overflow-hidden bg-black text-white">
        <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,0.32)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.32)_1px,transparent_1px)] [background-size:52px_52px]" />
        <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_50%_0%,rgba(185,28,28,0.34),transparent_52%)]" />

        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-56px)] w-full max-w-[96rem] flex-col px-5 pb-0 pt-24 md:px-8 md:pt-28 lg:px-12">
          <header className="mx-auto flex max-w-4xl flex-col items-center text-center">
            <Link
              href={primaryDomain?.href ?? "/events"}
              className="inline-flex min-h-8 items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.04)] transition-colors hover:bg-white/15"
            >
              Registry domain map
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <h1 className="mt-7 max-w-4xl text-balance text-5xl font-semibold leading-[0.95] text-white md:text-7xl lg:text-8xl">
              Ekairos Registry.
            </h1>
            <p className="mt-6 max-w-2xl text-balance text-base leading-7 text-white/72 md:text-xl md:leading-8">
              Technical marketing for the real domain system: schema, actions, and installable UI
              that can move into Workbench, templates, and product apps.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="#domains"
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-black transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-white/90"
              >
                Browse domains
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/registry"
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/15 px-4 py-2 text-sm font-semibold text-white transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-white/10"
              >
                View Manifest
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <div className="mt-9 grid w-full max-w-3xl grid-cols-2 border border-white/12 text-left md:grid-cols-4">
              {domainRegistry.map((domain) => (
                <Link
                  key={domain.id}
                  href={domain.href}
                  className="group min-h-24 border-b border-r border-white/12 p-4 transition-colors hover:bg-white hover:text-black md:border-b-0 md:last:border-r-0"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-500 group-hover:text-red-700">
                    /{domain.id}
                  </span>
                  <span className="mt-3 block text-lg font-semibold leading-tight">
                    {domain.title}
                  </span>
                  <span className="mt-2 block font-mono text-[10px] text-white/45 group-hover:text-black/55">
                    {domain.schemaPackage}
                  </span>
                </Link>
              ))}
            </div>
          </header>

          <HeroShowcase
            dependency={primaryDomain?.packageDependency ?? "@ekairos/events@beta"}
            component={primaryComponent?.registryName ?? "event-context-panel"}
            registryPath={primaryComponent?.registryPath ?? "/r/event-context-panel.json"}
          />
        </div>
      </section>

      <section className="border-b border-border bg-[#f4f6f7]">
        <div className="mx-auto grid w-full max-w-[92rem] gap-10 px-5 py-16 md:grid-cols-[minmax(0,0.68fr)_minmax(0,1.32fr)] md:px-12 md:py-24 lg:px-20">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-red-700">
              Where it starts
            </p>
            <h2 className="mt-5 max-w-xl text-4xl font-semibold leading-[0.95] md:text-6xl">
              Public surface first. Registry after it earns the shape.
            </h2>
          </div>
          <div className="grid min-w-0 border-t border-black/20 md:grid-cols-3 md:border-l md:border-t-0">
            {LOOP_STEPS.map((step, index) => (
              <div
                key={step.label}
                className="group border-b border-black/20 py-7 md:border-b-0 md:border-r md:px-7 md:last:border-r-0"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs uppercase tracking-[0.24em] text-red-700">
                    0{index + 1}
                  </span>
                  <span className="h-px min-w-8 flex-1 bg-black/20 transition-colors group-hover:bg-black" />
                </div>
                <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                  {step.label}
                </p>
                <h3 className="mt-4 text-2xl font-semibold leading-tight">{step.title}</h3>
                <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-black text-white">
        <div className="mx-auto grid w-full max-w-[92rem] gap-12 px-5 py-16 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] md:px-12 md:py-24 lg:px-20">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-red-500">
              Domain map
            </p>
            <h2 className="mt-5 max-w-xl text-4xl font-semibold leading-[0.95] md:text-6xl">
              Four routes become the technical front door.
            </h2>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/65">
              Each domain has one public landing, one UI surface, and one library page. The package
              remains the source of behavior; the registry owns distribution.
            </p>
          </div>

          <DomainOperatingMap />
        </div>
      </section>

      <section id="domains" className="scroll-mt-20 border-b border-border bg-background">
        <div className="mx-auto grid w-full max-w-[92rem] gap-10 px-5 py-16 md:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] md:px-12 md:py-24 lg:px-20">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-red-700">
              Domains
            </p>
            <h2 className="mt-5 max-w-xl text-4xl font-semibold leading-[0.95] md:text-6xl">
              Events, Sandbox, Dataset, Task.
            </h2>
          </div>

          <div className="min-w-0 border-y border-border">
            {domainRegistry.map((domain) => (
              <Link
                key={domain.id}
                href={domain.href}
                className="group grid gap-6 border-b border-border py-8 last:border-b-0 md:grid-cols-[8rem_minmax(0,1fr)_auto]"
              >
                <div className="font-mono text-sm text-foreground">/{domain.id}</div>
                <div className="min-w-0">
                  <p className="text-3xl font-semibold leading-tight">{domain.title}</p>
                  <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {domain.summary}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {domain.components.length > 0 ? (
                      domain.components.map((component) => (
                        <span
                          key={component.id}
                          className="border border-border px-2.5 py-1 font-mono text-xs text-foreground transition-colors group-hover:border-foreground"
                        >
                          {component.registryName}
                        </span>
                      ))
                    ) : (
                      <span className="border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors group-hover:border-foreground">
                        showcase-first
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-2 font-mono text-xs text-muted-foreground md:justify-end">
                  <span>{domain.aggregateRoot}</span>
                  <ArrowRight
                    className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-red-700 text-white">
        <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-8 px-5 py-12 md:flex-row md:items-center md:justify-between md:px-12 lg:px-20">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-white/65">
              Manifest
            </p>
            <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-[0.95] md:text-6xl">
              Install UI. Keep behavior in the domain package.
            </h2>
          </div>
          <Link
            href="/registry"
            className="inline-flex min-h-12 w-fit items-center gap-2 border border-white/40 px-5 py-3 text-sm font-semibold transition-[background-color,color,transform] hover:-translate-y-0.5 hover:bg-white hover:text-red-700"
          >
            View Manifest
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}

function DomainOperatingMap() {
  return (
    <div className="min-w-0 border-y border-white/20">
      {domainRegistry.map((domain) => (
        <div
          key={domain.id}
          className="grid gap-5 border-b border-white/20 py-6 last:border-b-0 md:grid-cols-[9rem_minmax(0,1fr)_minmax(0,0.7fr)]"
        >
          <div>
            <p className="font-mono text-sm text-red-500">/{domain.id}</p>
            <p className="mt-2 text-2xl font-semibold leading-tight">{domain.title}</p>
          </div>
          <div className="grid gap-3 font-mono text-xs text-white/66">
            <Link href={domain.href} className="group/route flex items-center justify-between gap-4 border border-white/12 px-3 py-2 transition-colors hover:bg-white hover:text-black">
              <span>{domain.href}</span>
              <span className="text-white/36 group-hover/route:text-black/45">landing</span>
            </Link>
            <Link href={domain.componentsHref} className="group/route flex items-center justify-between gap-4 border border-white/12 px-3 py-2 transition-colors hover:bg-white hover:text-black">
              <span>{domain.componentsHref}</span>
              <span className="text-white/36 group-hover/route:text-black/45">ui</span>
            </Link>
            <Link href={domain.domainHref} className="group/route flex items-center justify-between gap-4 border border-white/12 px-3 py-2 transition-colors hover:bg-white hover:text-black">
              <span>{domain.domainHref}</span>
              <span className="text-white/36 group-hover/route:text-black/45">library</span>
            </Link>
          </div>
          <div className="grid content-start gap-2 text-sm leading-6 text-white/58">
            <p className="font-mono text-xs text-white">{domain.packageDependency}</p>
            <p>
              <span className="font-mono text-white/80">{domain.aggregateRoot}</span> anchors{" "}
              <span className="font-mono text-white/80">{domain.durableSurface}</span>.
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function HeroShowcase({
  dependency,
  component,
  registryPath,
}: {
  dependency: string;
  component: string;
  registryPath: string;
}) {
  return (
    <div className="mt-16 grid min-h-[34rem] gap-6 md:grid-cols-[0.95fr_1fr_0.95fr] lg:gap-8">
      <div className="hidden min-h-0 flex-col gap-6 md:flex">
        <div className="rounded-lg border border-white/10 bg-[#0b0b0c] p-6 shadow-2xl">
          <p className="text-lg font-semibold">Install surface</p>
          <p className="mt-1 text-sm leading-6 text-white/58">
            Pull UI from the registry. Import behavior from the domain package.
          </p>
          <div className="mt-6 grid gap-4">
            <label className="grid gap-2 text-sm font-medium">
              Registry URL
              <span className="rounded-md border border-white/10 bg-white/[0.06] px-3 py-2 font-mono text-xs text-white/70">
                registry.ekairos.dev{registryPath}
              </span>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Package
              <span className="rounded-md border border-white/10 bg-white/[0.06] px-3 py-2 font-mono text-xs text-white/70">
                {dependency}
              </span>
            </label>
          </div>
          <button className="mt-6 inline-flex min-h-10 items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-black">
            Add component
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#0f0f10] p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/45">registry</p>
            <span className="rounded-full bg-red-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]">
              live
            </span>
          </div>
          <div className="mt-5 grid gap-3">
            {["showcase", "component", "manifest"].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-md border border-white/10 px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-white" />
                <span className="font-mono text-xs text-white/70">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 rounded-lg border border-white/10 bg-[#0b0b0c] shadow-[0_18px_80px_rgba(0,0,0,0.55)]">
        <div className="border-b border-white/10 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-red-500">events</p>
              <p className="mt-3 text-2xl font-semibold md:text-3xl">Event context panel</p>
            </div>
            <span className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-xs text-white/58">
              {component}
            </span>
          </div>
        </div>

        <div className="grid gap-0 md:grid-cols-[0.86fr_1.14fr]">
          <div className="border-b border-white/10 p-5 md:border-b-0 md:border-r">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">
              context
            </p>
            <div className="mt-5 grid gap-4">
              {[
                ["event_contexts", "active aggregate"],
                ["event_items", "durable history"],
                ["executions", "runtime trace"],
              ].map(([title, body]) => (
                <div key={title} className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                  <p className="font-mono text-xs text-white">{title}</p>
                  <p className="mt-1 text-xs text-white/48">{body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="p-5">
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
              <p className="font-semibold">Prepare purchase order response</p>
              <p className="mt-2 text-sm leading-6 text-white/58">
                The UI renders the current turn while the Events package owns the stream and
                persisted state.
              </p>
            </div>

            <div className="mt-4 grid gap-3">
              {[
                ["input", "Buyer requests delivery ETA and terms."],
                ["tool", "Searches related event items."],
                ["output", "Draft response ready for review."],
              ].map(([label, body]) => (
                <div key={label} className="flex gap-3 rounded-md border border-white/10 p-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-600" />
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/42">
                      {label}
                    </p>
                    <p className="mt-1 text-sm text-white/70">{body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-white/70" />
              <span className="flex-1 text-sm text-white/45">Ask, search, or make anything...</span>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-black">Run</span>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden min-h-0 flex-col gap-6 md:flex">
        <div className="rounded-lg border border-white/10 bg-[#111112] p-5">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
            <span className="text-xs text-white/42">https://</span>
            <span className="font-mono text-xs text-white/70">registry.ekairos.dev</span>
          </div>

          <div className="mt-5 rounded-lg border border-white/10 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold">Manifest verified</p>
                <p className="mt-1 text-sm text-white/55">Component type: registry:component</p>
              </div>
              <ArrowRight className="h-4 w-4 text-white/50" aria-hidden="true" />
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-white/10 p-4">
            <p className="font-semibold">Install command</p>
            <code className="mt-3 block break-all rounded-md bg-white/[0.06] px-3 py-2 font-mono text-xs leading-5 text-white/64">
              pnpm dlx shadcn@latest add https://registry.ekairos.dev{registryPath}
            </code>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#0b0b0c] p-5">
          <p className="font-semibold">Workbench ready</p>
          <p className="mt-2 text-sm leading-6 text-white/58">
            The same surface lands in Workbench domain routes and generated templates.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {["domain events", "tailwind", "templates"].map((item) => (
              <span key={item} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/58">
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

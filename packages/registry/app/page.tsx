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

  return (
    <main className="min-h-[calc(100svh-56px)] bg-background text-foreground">
      <section className="relative isolate min-h-[calc(100svh-56px)] overflow-hidden bg-black text-white">
        <img
          src="/registry-domain-landscape.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-center opacity-100 brightness-[1.22] contrast-[1.05] saturate-[1.08]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0.12)_48%,rgba(0,0,0,0.42)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(97,233,255,0.18),transparent_32%),radial-gradient(circle_at_48%_38%,rgba(255,92,103,0.12),transparent_35%)]" />
        <div className="absolute inset-x-0 bottom-0 h-[28%] bg-[linear-gradient(180deg,transparent_0%,rgba(0,0,0,0.22)_45%,rgba(0,0,0,0.58)_100%)]" />

        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-56px)] w-full max-w-[96rem] flex-col justify-start px-5 pb-10 pt-12 md:px-8 md:pt-20 lg:px-12 lg:pt-24">
          <header className="mx-auto flex max-w-4xl flex-col items-center text-center">
            <Link
              href={primaryDomain?.href ?? "/events"}
              className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[#61e9ff]/30 bg-[#61e9ff]/10 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_36px_rgba(97,233,255,0.12)] transition-colors hover:bg-[#61e9ff]/15"
            >
              Registry domain map
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <h1 className="mt-7 max-w-4xl text-balance text-5xl font-semibold leading-[0.95] text-white md:text-7xl lg:text-8xl">
              Ekairos Registry.
            </h1>
            <p className="mt-6 max-w-2xl text-balance text-base leading-7 text-white/72 md:text-xl md:leading-8">
              The home of the Ekairos domains: schema, actions, and installable UI that run on
              InstantDB. Browse a domain, try its components on a live temporary database, install
              them with one command.
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
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#61e9ff]/22 px-4 py-2 text-sm font-semibold text-white transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-[#61e9ff]/10"
              >
                View Manifest
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <div className="mt-9 grid w-full max-w-3xl grid-cols-2 border border-white/12 bg-black/60 text-left shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-[2px] md:grid-cols-5">
              {domainRegistry.map((domain, index) => (
                <Link
                  key={domain.id}
                  href={domain.href}
                  className="group min-h-20 border-b border-r border-white/12 bg-black/10 p-4 transition-colors hover:bg-white hover:text-black md:border-b-0 md:last:border-r-0"
                >
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.22em] group-hover:text-black/65 ${
                      index % 2 === 0 ? "text-[#ff5c67]" : "text-[#61e9ff]"
                    }`}
                  >
                    /{domain.id}
                  </span>
                  <span className="mt-3 block text-base font-semibold leading-tight">
                    {domain.title}
                  </span>
                </Link>
              ))}
            </div>
          </header>
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
              Five routes become the technical front door.
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
              Events, Channel, Sandbox, Dataset, Task.
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

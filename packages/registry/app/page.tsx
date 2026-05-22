import Link from "next/link";
import { ArrowRight, Boxes, GitBranch, PackageCheck, Waypoints } from "lucide-react";

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

const CONTRACT_STEPS = [
  {
    label: "schema",
    value: "event_contexts",
  },
  {
    label: "actions",
    value: "@ekairos/events",
  },
  {
    label: "ui",
    value: "event-context-panel",
  },
] as const;

export default function HomePage() {
  const publishedComponents = domainRegistry.flatMap((domain) => domain.components);
  const primaryDomain = domainRegistry[0];
  const primaryComponent = primaryDomain?.components[0];

  return (
    <main className="min-h-[calc(100svh-56px)] bg-background text-foreground">
      <section className="overflow-hidden border-b border-border">
        <div className="mx-auto grid min-h-[calc(100svh-112px)] w-full max-w-[88rem] content-center gap-12 px-4 py-12 md:grid-cols-[minmax(0,0.92fr)_minmax(24rem,1.08fr)] md:px-8 md:py-16 lg:min-h-[calc(100svh-144px)] lg:gap-16">
          <header className="flex min-w-0 flex-col justify-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-muted-foreground">
              Registry
            </p>
            <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[0.96] md:text-7xl lg:text-8xl">
              Domain components, ready to install.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
              Publish each domain surface once. Reuse it in Workbench, templates, and product
              apps with its runtime package attached.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/events/components"
                className="inline-flex min-h-10 items-center gap-2 border border-foreground bg-foreground px-4 py-2 text-sm font-medium text-background transition-[opacity,transform] hover:-translate-y-0.5 hover:opacity-90"
              >
                Open Events
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/registry"
                className="inline-flex min-h-10 items-center gap-2 border border-border px-4 py-2 text-sm text-foreground transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-muted/50"
              >
                View manifest
                <PackageCheck className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <dl className="mt-12 grid max-w-xl grid-cols-3 border-y border-border py-5">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                  domains
                </dt>
                <dd className="mt-2 text-2xl font-semibold">{domainRegistry.length}</dd>
              </div>
              <div className="border-x border-border px-5">
                <dt className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                  items
                </dt>
                <dd className="mt-2 text-2xl font-semibold">{publishedComponents.length}</dd>
              </div>
              <div className="pl-5">
                <dt className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                  loop
                </dt>
                <dd className="mt-2 text-2xl font-semibold">e2e</dd>
              </div>
            </dl>
          </header>

          <RegistryFlowVisual
            domainTitle={primaryDomain?.title ?? "Domains"}
            packageName={primaryDomain?.packageDependency ?? "@ekairos/domain"}
            componentName={primaryComponent?.registryName ?? "domain-component"}
            registryPath={primaryComponent?.registryPath ?? "/r/component.json"}
          />
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-[88rem] gap-10 px-4 py-14 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] md:px-8 md:py-20">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              loop
            </p>
            <h2 className="mt-4 max-w-lg text-3xl font-semibold leading-tight md:text-5xl">
              Showcase, component, registry.
            </h2>
          </div>
          <div className="grid min-w-0 border-t border-border md:grid-cols-3 md:border-l md:border-t-0">
            {LOOP_STEPS.map((step, index) => (
              <div
                key={step.label}
                className="group border-b border-border py-6 md:border-b-0 md:border-r md:px-6 md:last:border-r-0"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    0{index + 1}
                  </span>
                  <span className="h-px min-w-8 flex-1 bg-border transition-colors group-hover:bg-foreground" />
                </div>
                <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                  {step.label}
                </p>
                <h3 className="mt-3 text-xl font-semibold leading-snug">{step.title}</h3>
                <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-[88rem] gap-10 px-4 py-14 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:px-8 md:py-20">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            domains
          </p>
          <h2 className="mt-4 max-w-xl text-3xl font-semibold leading-tight md:text-5xl">
            Domain surfaces are grouped by domain.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            Events is the first published surface. The registry stays generic; domains own the
            schema, actions, runtime, and UI contract.
          </p>
        </div>

        <div className="min-w-0 border-y border-border">
          {domainRegistry.map((domain) => (
            <Link
              key={domain.id}
              href={domain.href}
              className="group grid gap-6 py-7 md:grid-cols-[7rem_minmax(0,1fr)_auto]"
            >
              <div className="font-mono text-sm text-foreground">/{domain.id}</div>
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-tight">{domain.title}</p>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {domain.summary}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {domain.components.map((component) => (
                    <span
                      key={component.id}
                      className="border border-border px-2.5 py-1 font-mono text-xs text-foreground transition-colors group-hover:border-foreground"
                    >
                      {component.registryName}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-start gap-2 font-mono text-xs text-muted-foreground md:justify-end">
                <span>{domain.packageDependency}</span>
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-foreground text-background">
        <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-6 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-8">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-background/60">
              manifest
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight md:text-5xl">
              Install from the manifest. Keep behavior in the package.
            </h2>
          </div>
          <Link
            href="/registry"
            className="inline-flex min-h-10 w-fit items-center gap-2 border border-background/30 px-4 py-2 text-sm font-medium transition-[background-color,color,transform] hover:-translate-y-0.5 hover:bg-background hover:text-foreground"
          >
            View registry
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}

function RegistryFlowVisual({
  domainTitle,
  packageName,
  componentName,
  registryPath,
}: {
  domainTitle: string;
  packageName: string;
  componentName: string;
  registryPath: string;
}) {
  return (
    <div className="relative min-w-0">
      <div className="absolute -left-6 top-8 hidden h-[calc(100%-4rem)] w-px bg-border md:block" />
      <div className="grid min-h-[34rem] overflow-hidden border border-border bg-background shadow-[0_32px_90px_-70px_rgba(15,23,42,0.9)]">
        <div className="grid border-b border-border md:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="min-w-0 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
              distribution preview
            </p>
            <p className="mt-3 text-2xl font-semibold leading-tight">{domainTitle} domain</p>
          </div>
          <div className="grid content-center border-t border-border p-5 md:border-l md:border-t-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              published
            </p>
            <p className="mt-2 text-3xl font-semibold">01</p>
          </div>
        </div>

        <div className="grid border-b border-border md:grid-cols-3">
          {CONTRACT_STEPS.map((step, index) => (
            <div
              key={step.label}
              className="min-w-0 border-b border-border p-5 md:border-b-0 md:border-r md:last:border-r-0"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                0{index + 1} / {step.label}
              </p>
              <p className="mt-4 break-words font-mono text-sm">{step.value}</p>
            </div>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <div className="border-b border-border p-5 md:border-b-0 md:border-r">
            <div className="flex items-center gap-3">
              <Waypoints className="h-4 w-4" aria-hidden="true" />
              <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-muted-foreground">
                route
              </p>
            </div>
            <div className="mt-8 grid gap-5">
              {[
                ["showcase", "/events/components"],
                ["manifest", registryPath],
                ["workbench", "domain events"],
              ].map(([label, value]) => (
                <div key={label} className="grid gap-1.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {label}
                  </p>
                  <p className="min-w-0 break-words font-mono text-sm">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-between gap-8 p-5">
            <div>
              <div className="flex items-center gap-3">
                <Boxes className="h-4 w-4" aria-hidden="true" />
                <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-muted-foreground">
                  component
                </p>
              </div>
              <p className="mt-4 text-3xl font-semibold leading-tight">{componentName}</p>
              <p className="mt-3 max-w-md break-words text-sm leading-6 text-muted-foreground">
                Thin UI shell. Domain package dependency. No registry-specific hook adapter.
              </p>
            </div>

            <div className="border-t border-border pt-5">
              <div className="flex items-center gap-3">
                <GitBranch className="h-4 w-4" aria-hidden="true" />
                <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-muted-foreground">
                  install
                </p>
              </div>
              <code className="mt-4 block break-all border border-border bg-muted/35 px-3 py-2 font-mono text-xs leading-5">
                npx shadcn@latest add https://registry.ekairos.dev{registryPath}
              </code>
              <p className="mt-3 font-mono text-xs text-muted-foreground">{packageName}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buildRegistriesConfig, getDomainRegistryById } from "@/lib/domain-registries";

export const metadata = {
  title: "@ekairos-task | Ekairos Registry",
  description:
    "The task registry: UI for durable human decisions — typed outcomes, decision panels, queues, and outcome timelines.",
};

const LIFECYCLE = [
  { state: "open", body: "openTask creates or reuses a durable task, idempotent by key." },
  { state: "waiting", body: "awaitOutcome blocks the workflow until a typed outcome exists." },
  { state: "decided", body: "decideTask validates the outcome against its schema and closes." },
  { state: "terminal", body: "cancelTask / failTask close without a successful outcome." },
] as const;

const PLANNED = [
  {
    name: "task-decision-panel",
    label: "TaskDecisionPanel",
    body: "Decision controls generated from the outcome schema — approve, reject, comment, typed fields.",
  },
  {
    name: "task-queue-item",
    label: "TaskQueueItem",
    body: "The pending-decision row for Workbench and product inboxes: kind, instructions, context, age.",
  },
  {
    name: "task-outcome-timeline",
    label: "TaskOutcomeTimeline",
    body: "Outcomes linked back to the Events executions that waited on them.",
  },
] as const;

export default function TaskRegistryPage() {
  const registry = getDomainRegistryById("task");
  if (!registry) {
    return null;
  }

  return (
    <main className="min-h-[calc(100svh-56px)] bg-background text-foreground">
      <section className="border-b-4 border-red-700">
        <div className="mx-auto w-full max-w-[88rem] px-4 py-14 md:px-8 md:py-20">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-red-700">
            <Link href="/registries" className="transition-colors hover:text-foreground">
              registries
            </Link>{" "}
            / task
          </p>
          <div className="mt-6 grid gap-10 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="min-w-0">
              <h1 className="font-mono text-4xl font-semibold leading-tight md:text-6xl">
                {registry.namespace}
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
                Typed human work inside AI workflows. A workflow stops, a person decides, the
                outcome is validated and durable. This registry will ship that decision surface
                for <span className="font-mono text-red-700">{registry.schemaPackage}</span>.
              </p>
              <div className="mt-8 flex flex-wrap gap-4 font-mono text-xs">
                <a
                  href={registry.manifestPath}
                  className="border border-red-700/40 bg-red-700/5 px-3 py-2 text-foreground transition-colors hover:bg-red-700/10"
                >
                  {registry.manifestPath}
                </a>
                <span className="border border-border px-3 py-2 text-muted-foreground">
                  namespace reserved · first items in progress
                </span>
              </div>
            </div>

            <div className="min-w-0 border border-border">
              <div className="border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-red-700">
                task_tasks · lifecycle
              </div>
              <div className="grid">
                {LIFECYCLE.map((entry) => (
                  <div
                    key={entry.state}
                    className="grid gap-2 border-b border-border px-4 py-3 last:border-b-0 md:grid-cols-[6.5rem_minmax(0,1fr)]"
                  >
                    <span className="font-mono text-xs uppercase tracking-[0.18em] text-red-700">
                      {entry.state}
                    </span>
                    <p className="text-sm leading-6 text-muted-foreground">{entry.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-[88rem] gap-8 px-4 py-10 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:px-8">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-red-700">
              setup
            </p>
            <h2 className="mt-4 max-w-md text-2xl font-semibold leading-tight">
              The package owns state and validation. The registry owns the panel.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              Assignment, approvers, and notifications stay in your product domain — exactly
              like the approval flows already running in production. The installable UI only
              renders the decision.
            </p>
          </div>
          <pre className="min-w-0 overflow-x-auto bg-muted/45 p-4 font-mono text-xs leading-6">
            <code>{buildRegistriesConfig([registry])}</code>
          </pre>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[88rem] px-4 py-10 md:px-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-red-700">
          planned items
        </p>
        <div className="mt-4 grid gap-px border border-border bg-border md:grid-cols-3">
          {PLANNED.map((item) => (
            <div key={item.name} className="bg-background p-6">
              <p className="font-mono text-xs text-red-700">{item.name}</p>
              <h3 className="mt-3 text-xl font-semibold">{item.label}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.body}</p>
              <p className="mt-5 font-mono text-[11px] text-muted-foreground/80">
                {`shadcn add ${registry.namespace}/${item.name}`}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-6 border-t border-border pt-8">
          <p className="max-w-2xl text-xl font-semibold leading-tight md:text-2xl">
            Every approval that ships in product is a candidate for this registry.
          </p>
          <Link
            href={registry.domain.href}
            className="inline-flex w-fit items-center gap-2 border border-red-700 px-4 py-3 font-mono text-xs uppercase tracking-[0.2em] text-red-700 transition-colors hover:bg-red-700 hover:text-white"
          >
            task domain
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}

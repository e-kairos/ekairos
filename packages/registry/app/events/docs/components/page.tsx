import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Callout, DocPage, InlineCode, Section } from "../_kit";

export const metadata = {
  title: "Events components | Ekairos Registry",
  description: "Documented UI components for the events domain: prompt, activity, artifacts, evidence and source state.",
};

const DOCUMENTED = [
  {
    href: "/events/docs/components/prompt",
    label: "Prompt",
    registryName: "prompt",
    description: "Controlled agent input with attachments, paste/drag & drop, status and stop.",
  },
  {
    href: "/events/docs/components/prompt-file-chip",
    label: "PromptFileChip",
    registryName: "prompt-file-chip",
    description: "Attachment chip with file type, upload status, errors and artifact-context mode.",
  },
  {
    href: "/events/docs/components/context-activity-indicator",
    label: "ContextActivityIndicator",
    registryName: "context-activity-indicator",
    description: "Dot-matrix heartbeat for thinking, working, streaming, upload and error phases.",
  },
  {
    href: "/events/docs/components/message-artifact",
    label: "MessageArtifact",
    registryName: "message-artifact",
    description: "Framed shell for message-owned previews, generated files and diagrams.",
  },
  {
    href: "/events/docs/components/temporal-evidence-list",
    label: "TemporalEvidenceList",
    registryName: "temporal-evidence-list",
    description: "Timed evidence cues linking claims to replays, traces and documents.",
  },
  {
    href: "/events/docs/components/source-watch-status",
    label: "SourceWatchStatus",
    registryName: "source-watch-status",
    description: "One status row for watched sources: scanning, stabilizing, loaded, error.",
  },
] as const;

const RUNTIME_BOUND = [
  {
    label: "ContextAgent",
    registryName: "context-agent",
    description: "Full agent shell composing context state, messages, prompt, history and actions.",
  },
  {
    label: "MessageList",
    registryName: "message-list",
    description: "Maps live context events and steps into conversational output and action renderers.",
  },
  {
    label: "PromptBar",
    registryName: "prompt-bar",
    description: "Context-aware prompt composer wired to send, upload, web search and stop state.",
  },
] as const;

export default function EventsComponentsIndexPage() {
  return (
    <DocPage
      eyebrow="events / components"
      title="Components"
      lead={
        <>
          The simplest way to think about it: <strong className="text-foreground">the UI pieces an
          event-driven agent needs</strong>, split in two. Presentational components you can drop
          anywhere and preview below — and runtime-bound components that only make sense plugged
          into a live context.
        </>
      }
    >
      <Section title="With live previews">
        <p>
          These are pure presentational components — every page below renders them live, shadcn
          style, with the source one tab away:
        </p>
        <nav className="grid gap-px border border-border bg-border md:grid-cols-2">
          {DOCUMENTED.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group grid gap-1 bg-background p-4 transition-colors hover:bg-muted/40"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {item.label}
                <ArrowRight
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </span>
              <span className="text-sm leading-6 text-muted-foreground">{item.description}</span>
              <span className="font-mono text-[11px] text-muted-foreground/80">
                /r/{item.registryName}.json
              </span>
            </Link>
          ))}
        </nav>
      </Section>

      <Section title="Runtime-bound">
        <p>
          These components consume a live <InlineCode>ContextValue</InlineCode> from{" "}
          <InlineCode>@ekairos/events/react</InlineCode> — there is no meaningful static preview, so
          they are documented on the events surface instead:
        </p>
        <div className="grid gap-px border border-border bg-border">
          {RUNTIME_BOUND.map((item) => (
            <div key={item.registryName} className="grid gap-1 bg-background p-4">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {item.label}
                <span className="font-mono text-[11px] font-normal text-muted-foreground/80">
                  /r/{item.registryName}.json
                </span>
              </span>
              <span className="text-sm leading-6 text-muted-foreground">{item.description}</span>
              <span className="text-sm leading-6 text-muted-foreground">
                Requires a live context — see the{" "}
                <Link href="/events/components" className="underline underline-offset-2 hover:text-foreground">
                  events surface
                </Link>{" "}
                and the{" "}
                <Link href="/examples" className="underline underline-offset-2 hover:text-foreground">
                  examples
                </Link>
                .
              </span>
            </div>
          ))}
        </div>
        <Callout>
          Runtime-bound components ship as source in the repo — publishing to the registry endpoint
          is in progress.
        </Callout>
      </Section>
    </DocPage>
  );
}

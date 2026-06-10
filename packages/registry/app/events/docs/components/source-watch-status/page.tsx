import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";
import { ComponentPreview } from "@/components/ekairos/docs/component-preview";
import { SourceWatchOpenPreview, SourceWatchPhasesPreview } from "../../_previews";

export const metadata = {
  title: "SourceWatchStatus | Ekairos Registry",
  description: "One row that tells you whether a watched source is scanning, stabilizing, loaded or broken.",
};

export default function SourceWatchStatusDocPage() {
  return (
    <DocPage
      eyebrow="events / components / source-watch-status"
      title="SourceWatchStatus"
      lead={
        <>
          The simplest way to think about it: <strong className="text-foreground">a status row for
          something the agent is watching</strong>. A replay folder, an imports feed, a webhook
          stream — each gets one row with an icon, a phase label, the item count and when it was
          last checked. Agnostic by design: you feed it a status object, it renders the state.
        </>
      }
    >
      <Section title="Preview">
        <ComponentPreview
          align="start"
          minHeight="16rem"
          code={`<SourceWatchStatus status={{ phase: "checking", sourceLabel: "Replay folder", pollIntervalMs: 5000 }} />
<SourceWatchStatus status={{ phase: "waiting", sourceLabel: "Replay folder", detail: "Waiting for a stable snapshot" }} />
<SourceWatchStatus status={{ phase: "loaded", sourceLabel: "Replay folder", sourceCount: 3, checkedAt: new Date() }} />
<SourceWatchStatus status={{ phase: "error", sourceLabel: "Imports feed", detail: "Credentials expired" }} />`}
        >
          <SourceWatchPhasesPreview />
        </ComponentPreview>
      </Section>

      <Section title="Install">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/source-watch-status.json`}</Code>
        <Callout>
          source in repo — publishing to the registry endpoint is in progress.
        </Callout>
      </Section>

      <Section title="Start simple: a phase and a label">
        <p>
          The only required field on <InlineCode>status</InlineCode> is{" "}
          <InlineCode>phase</InlineCode> — one of <InlineCode>checking</InlineCode>,{" "}
          <InlineCode>waiting</InlineCode>, <InlineCode>loading</InlineCode>,{" "}
          <InlineCode>loaded</InlineCode>, <InlineCode>empty</InlineCode> or{" "}
          <InlineCode>error</InlineCode>. Busy phases spin, <InlineCode>loaded</InlineCode> goes
          green, <InlineCode>error</InlineCode> goes red. Everything else is optional detail:
        </p>
        <Code title="basic">{`import { SourceWatchStatus } from "@/components/ekairos/events/context-agent/ui/source-watch-status";

<SourceWatchStatus
  status={{
    phase: "loaded",
    sourceLabel: "Replay folder",
    sourcePath: "s3://replays/session-4812",
    sourceCount: 3,
    checkedAt: new Date(),
    pollIntervalMs: 30_000, // shown as "30s" cadence
  }}
/>`}</Code>
      </Section>

      <Section title="Then: make it clickable and rename phases">
        <p>
          Pass <InlineCode>onOpen</InlineCode> and the row becomes a button (open the folder, the
          feed, the import detail…). The <InlineCode>labels</InlineCode> prop overrides the default
          phase wording per phase — useful when “Loaded” should read like your domain:
        </p>
        <ComponentPreview
          align="start"
          minHeight="10rem"
          code={`<SourceWatchStatus
  status={{ phase: "loaded", sourceLabel: "Replay folder", sourceCount: 3, checkedAt: new Date() }}
  labels={{ loaded: "Replay ready" }}
  onOpen={() => openReplayFolder()}
/>`}
        >
          <SourceWatchOpenPreview />
        </ComponentPreview>
        <Callout>
          In a live surface you derive the status object from your watcher (polling loop, webhook
          consumer, import job) and just re-render — the component is stateless.
        </Callout>
      </Section>

      <Section title="Props">
        <PropsTable
          rows={[
            { name: "status", type: "SourceWatchStatusValue", required: true, description: "The watch state (fields below)." },
            { name: "labels", type: "Partial<Record<phase, string>>", description: "Override the label for any phase." },
            { name: "onOpen", type: "() => void", description: "Renders the row as a button." },
            { name: "ariaLabelPrefix", type: "string", description: "Accessibility prefix. Default: “Source watch”." },
            { name: "className", type: "string", description: "Row class." },
            { name: "status.phase", type: '"checking" | "waiting" | "loading" | "loaded" | "empty" | "error"', required: true, description: "Drives icon, color and busy state." },
            { name: "status.sourceLabel / sourcePath / detail", type: "string", description: "Second line, in priority order; path and detail also feed the hover title." },
            { name: "status.sourceCount", type: "number", description: "Right-aligned count. Default: 0." },
            { name: "status.checkedAt", type: "Date | string", description: "Last check time, shown as hh:mm:ss." },
            { name: "status.pollIntervalMs", type: "number", description: "Shown as a cadence (e.g. 5s, 2m)." },
          ]}
        />
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            { href: "/events/docs/components/temporal-evidence-list", label: "TemporalEvidenceList", description: "Render the cues found inside the watched source." },
            { href: "/events/docs/components/context-activity-indicator", label: "ContextActivityIndicator", description: "The equivalent heartbeat for the agent itself." },
          ]}
        />
      </Section>
    </DocPage>
  );
}

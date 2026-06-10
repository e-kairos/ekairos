import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";
import { ComponentPreview } from "@/components/ekairos/docs/component-preview";
import { ActivityFinishingPreview, ActivityStatesPreview } from "../../_previews";

export const metadata = {
  title: "ContextActivityIndicator | Ekairos Registry",
  description: "A tiny dot-matrix readout of what the agent is doing right now.",
};

export default function ContextActivityIndicatorDocPage() {
  return (
    <DocPage
      eyebrow="events / components / context-activity-indicator"
      title="ContextActivityIndicator"
      lead={
        <>
          The simplest way to think about it: <strong className="text-foreground">a heartbeat for
          the agent</strong>. One small animated dot-matrix that tells the user whether the agent is
          thinking, calling a tool, streaming text, uploading, or hit an error — and gracefully plays
          a finishing animation when the turn ends.
        </>
      }
    >
      <Section title="Preview">
        <ComponentPreview
          align="start"
          minHeight="12rem"
          code={`<ContextActivityIndicator
  activity={{ label: "Pensando", pattern: "rings", speed: 1.25, tone: "info", animated: true }}
/>`}
        >
          <ActivityStatesPreview />
        </ComponentPreview>
      </Section>

      <Section title="Install">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/context-activity-indicator.json`}</Code>
        <Callout>
          source in repo — publishing to the registry endpoint is in progress.
        </Callout>
      </Section>

      <Section title="Start simple: render a state">
        <p>
          The component takes a plain <InlineCode>ContextActivityState</InlineCode> object — a label,
          a dot-matrix <InlineCode>pattern</InlineCode>, a <InlineCode>speed</InlineCode> and a{" "}
          <InlineCode>tone</InlineCode>. Pass <InlineCode>null</InlineCode> and it renders nothing.
          Hovering shows the label (or <InlineCode>title</InlineCode>, e.g. the running tool name) in
          a tooltip:
        </p>
        <Code title="basic">{`import {
  ContextActivityIndicator,
  type ContextActivityState,
} from "@/components/ekairos/events/context-agent/ui/context-activity-indicator";

const working: ContextActivityState = {
  label: "Trabajando",
  title: "Reconcile supplier bid items", // tooltip detail
  pattern: "full",
  speed: 3.2,
  tone: "warning",
  animated: true,
};

<ContextActivityIndicator activity={working} />`}</Code>
      </Section>

      <Section title="Then: the finishing sequence">
        <p>
          When <InlineCode>activity</InlineCode> goes from a live state back to{" "}
          <InlineCode>null</InlineCode>, the indicator does not just disappear — it plays a short{" "}
          <em>finishing → idle → fade-out</em> sequence so the end of a turn feels deliberate. Try
          it:
        </p>
        <ComponentPreview
          align="start"
          minHeight="10rem"
          code={`const [activity, setActivity] = useState<ContextActivityState | null>(streamingState);

// when the turn completes:
setActivity(null); // plays finishing → idle → fade out

<ContextActivityIndicator activity={activity} />`}
        >
          <ActivityFinishingPreview />
        </ComponentPreview>
      </Section>

      <Section title="Finally: derive the state from a live context">
        <p>
          In a real app you rarely build these objects by hand. The same file exports{" "}
          <InlineCode>getContextActivityState</InlineCode>, which inspects a live{" "}
          <InlineCode>ContextValue</InlineCode> from <InlineCode>@ekairos/events/react</InlineCode>{" "}
          and returns the right state for sending, streaming, reasoning, running actions, upload and
          error phases:
        </p>
        <Code title="live (plug & play)">{`"use client";
import { useContext } from "@ekairos/events/react";
import {
  ContextActivityIndicator,
  getContextActivityState,
} from "@/components/ekairos/events/context-agent/ui/context-activity-indicator";

const context = useContext(db, { key: contextKey });
const activity = getContextActivityState({ context, isUploading });

<ContextActivityIndicator activity={activity} />`}</Code>
        <Callout>
          The derivation needs a live context — see the events surface for the full agent shell that
          wires this for you.
        </Callout>
      </Section>

      <Section title="Props">
        <PropsTable
          rows={[
            { name: "activity", type: "ContextActivityState | null", required: true, description: "What to show. null hides the indicator (after the finishing sequence)." },
            { name: "density", type: '"default" | "compact"', description: "Compact shrinks the matrix for embedded surfaces." },
            { name: "activity.label", type: "string", required: true, description: "Short status word; also the default tooltip." },
            { name: "activity.title", type: "string", description: "Tooltip detail, e.g. the humanized running action name." },
            { name: "activity.pattern", type: '"diamond" | "full" | "outline" | "rose" | "cross" | "rings"', required: true, description: "Dot-matrix pattern." },
            { name: "activity.speed", type: "number", required: true, description: "Animation speed multiplier." },
            { name: "activity.tone", type: '"neutral" | "info" | "warning" | "error"', description: "Color treatment." },
            { name: "activity.animated", type: "boolean", description: "Disable the animation (e.g. for terminal error states)." },
            { name: "activity.phase", type: '"idle" | "live" | "finishing" | "error"', description: "Override the phase; live states play the finishing sequence when cleared." },
          ]}
        />
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            { href: "/events/docs/components/prompt", label: "Prompt", description: "The input this indicator usually sits next to." },
            { href: "/events/components", label: "Events surface", description: "The full agent shell with live context wiring." },
          ]}
        />
      </Section>
    </DocPage>
  );
}

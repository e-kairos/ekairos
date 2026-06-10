import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";
import { ComponentPreview } from "@/components/ekairos/docs/component-preview";
import { TemporalEvidenceBasicPreview, TemporalEvidenceInteractivePreview } from "../../_previews";

export const metadata = {
  title: "TemporalEvidenceList | Ekairos Registry",
  description: "Timed evidence cues that link an agent's claims back to replays, traces and documents.",
};

export default function TemporalEvidenceListDocPage() {
  return (
    <DocPage
      eyebrow="events / components / temporal-evidence-list"
      title="TemporalEvidenceList"
      lead={
        <>
          The simplest way to think about it: <strong className="text-foreground">footnotes with
          timestamps</strong>. When the agent says “the operator overrode the price at 4:11”, this
          list shows that cue — and clicking it can seek a replay, open a trace, or jump to the
          source document. The component is source-agnostic; you decide what a click does.
        </>
      }
    >
      <Section title="Preview">
        <ComponentPreview
          align="start"
          minHeight="12rem"
          code={`<TemporalEvidenceList
  items={[
    { time: 12, label: "Operator opens the tender form", kind: "replay", note: "session #4812" },
    { time: 188, label: "Price mismatch flagged", kind: "trace", sourceRef: "step reconcile.compare" },
    { label: "Original RFQ document", kind: "doc", note: "tender-spec.pdf, page 3" },
  ]}
/>`}
        >
          <TemporalEvidenceBasicPreview />
        </ComponentPreview>
      </Section>

      <Section title="Install">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/temporal-evidence-list.json`}</Code>
        <Callout>
          source in repo — publishing to the registry endpoint is in progress.
        </Callout>
      </Section>

      <Section title="Start simple: a static list">
        <p>
          Give it an array of items. Each needs only a <InlineCode>label</InlineCode>;{" "}
          <InlineCode>time</InlineCode> (seconds) is formatted as <InlineCode>m:ss</InlineCode> and
          prefixed to the label, <InlineCode>kind</InlineCode> shows as a small tag, and{" "}
          <InlineCode>note</InlineCode> / <InlineCode>sourceRef</InlineCode> render as the second
          line. Empty arrays render your <InlineCode>emptyState</InlineCode> (or nothing):
        </p>
        <Code title="basic">{`import { TemporalEvidenceList } from "@/components/ekairos/events/context-agent/ui/temporal-evidence-list";

<TemporalEvidenceList items={items} title="Evidence" maxItems={6} />`}</Code>
      </Section>

      <Section title="Then: make cues interactive">
        <p>
          Items become links when they carry an <InlineCode>href</InlineCode>, or buttons when you
          pass <InlineCode>onSelectItem</InlineCode>. Combine it with{" "}
          <InlineCode>activeItemKey</InlineCode> and <InlineCode>getItemKey</InlineCode> to highlight
          the selected cue — the typical pattern for driving a replay player:
        </p>
        <ComponentPreview
          align="start"
          minHeight="14rem"
          code={`const [activeKey, setActiveKey] = useState<string | null>(null);
const getItemKey = (item, index) => \`\${item.kind}:\${index}\`;

<TemporalEvidenceList
  items={items}
  title="Replay cues"
  maxItems={4}
  activeItemKey={activeKey}
  getItemKey={getItemKey}
  onSelectItem={(item, index) => {
    setActiveKey(getItemKey(item, index));
    player.seek(item.time ?? 0);
  }}
/>`}
        >
          <TemporalEvidenceInteractivePreview />
        </ComponentPreview>
        <Callout>
          <InlineCode>href</InlineCode> wins over <InlineCode>onSelectItem</InlineCode> per item — use
          links for documents and external traces, buttons for in-page seeking.
        </Callout>
      </Section>

      <Section title="Props">
        <PropsTable
          rows={[
            { name: "items", type: "TemporalEvidenceItem[]", required: true, description: "The cues: { label, time?, kind?, note?, sourceRef?, href? }." },
            { name: "title", type: "string", description: "Collapsible header label. Default: “Evidence”." },
            { name: "maxItems", type: "number", description: "Cap on visible cues. Default: 6." },
            { name: "onSelectItem", type: "(item, index) => void", description: "Renders cues without href as buttons." },
            { name: "activeItemKey", type: "string | null", description: "Key of the highlighted cue." },
            { name: "getItemKey", type: "(item, index) => string", description: "Stable key derivation; defaults to kind:label:time." },
            { name: "emptyState", type: "ReactNode", description: "Rendered when there are no items. Default: null." },
            { name: "className", type: "string", description: "Container class." },
          ]}
        />
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            { href: "/events/docs/components/source-watch-status", label: "SourceWatchStatus", description: "Show the state of the source these cues come from." },
            { href: "/events/docs/components/message-artifact", label: "MessageArtifact", description: "Frame the output the evidence supports." },
          ]}
        />
      </Section>
    </DocPage>
  );
}

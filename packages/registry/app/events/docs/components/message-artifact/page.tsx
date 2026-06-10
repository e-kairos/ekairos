import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";
import { ComponentPreview } from "@/components/ekairos/docs/component-preview";
import { MessageArtifactBasicPreview, MessageArtifactFullPreview } from "../../_previews";

export const metadata = {
  title: "MessageArtifact | Ekairos Registry",
  description: "A framed shell for anything an agent produces inside a message.",
};

export default function MessageArtifactDocPage() {
  return (
    <DocPage
      eyebrow="events / components / message-artifact"
      title="MessageArtifact"
      lead={
        <>
          The simplest way to think about it: <strong className="text-foreground">a picture frame
          for agent output</strong>. Whenever a turn produces something bigger than text — a
          generated file, a diagram, a preview, a table — wrap it in this shell and it gets a titled
          header, optional actions, and a consistent card treatment across your app.
        </>
      }
    >
      <Section title="Preview">
        <ComponentPreview
          align="start"
          minHeight="12rem"
          code={`<MessageArtifact title="supplier-quote-comparison.md">
  <pre>{markdownTable}</pre>
</MessageArtifact>`}
        >
          <MessageArtifactBasicPreview />
        </ComponentPreview>
      </Section>

      <Section title="Install">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/message-artifact.json`}</Code>
        <Callout>
          source in repo — publishing to the registry endpoint is in progress.
        </Callout>
      </Section>

      <Section title="Start simple: title plus content">
        <p>
          Only two things are required: a <InlineCode>title</InlineCode> and{" "}
          <InlineCode>children</InlineCode>. The default eyebrow reads “Artifact”, and the content
          area is just a padded slot — render anything inside:
        </p>
        <Code title="basic">{`import { MessageArtifact } from "@/components/ekairos/events/context-agent/ui/message-artifact";

<MessageArtifact title="supplier-quote-comparison.md">
  <YourPreview />
</MessageArtifact>`}</Code>
      </Section>

      <Section title="Then: eyebrow, description and actions">
        <p>
          The header grows with you: <InlineCode>eyebrow</InlineCode> categorizes the artifact
          (“Generated file”, “Diagram”…), <InlineCode>description</InlineCode> adds a one-line
          summary, and <InlineCode>actions</InlineCode> is a free slot on the right — open, download,
          copy, whatever your app needs:
        </p>
        <ComponentPreview
          align="start"
          minHeight="14rem"
          code={`<MessageArtifact
  eyebrow="Generated file"
  title="reconciliation-report.xlsx"
  description="212 bid items matched against 3 supplier quotes"
  actions={<Button onClick={open}>Open</Button>}
>
  <SummaryText />
</MessageArtifact>`}
        >
          <MessageArtifactFullPreview />
        </ComponentPreview>
      </Section>

      <Section title="Finally: anchor it for the prompt bridge">
        <p>
          Pass the <InlineCode>actionCallId</InlineCode> of the action that produced the artifact and
          the shell stamps a <InlineCode>data-ek-artifact-anchor</InlineCode> attribute. Artifact-context
          attachments in the prompt (see <InlineCode>PromptFileChip</InlineCode>) can then scroll the
          thread back to this exact artifact:
        </p>
        <Code title="anchored">{`<MessageArtifact
  actionCallId={part.actionCallId}
  eyebrow="Diagram"
  title="Order flow"
>
  <Mermaid chart={chart} />
</MessageArtifact>`}</Code>
      </Section>

      <Section title="Props">
        <PropsTable
          rows={[
            { name: "title", type: "ReactNode", required: true, description: "Header title; truncates when long." },
            { name: "children", type: "ReactNode", required: true, description: "Artifact body — any content." },
            { name: "eyebrow", type: "ReactNode", description: "Small uppercase category label. Default: “Artifact”." },
            { name: "description", type: "ReactNode", description: "One-line summary under the title." },
            { name: "actions", type: "ReactNode", description: "Right-aligned header slot for buttons." },
            { name: "actionCallId", type: "string", description: "Anchors the artifact for prompt-bridge scroll-back." },
            { name: "className", type: "string", description: "Outer card class." },
            { name: "contentClassName", type: "string", description: "Body padding/layout class." },
          ]}
        />
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            { href: "/events/docs/components/prompt-file-chip", label: "PromptFileChip", description: "Artifact-context chips that link back to anchored artifacts." },
            { href: "/events/docs/components/temporal-evidence-list", label: "TemporalEvidenceList", description: "Pair artifacts with the evidence that produced them." },
          ]}
        />
      </Section>
    </DocPage>
  );
}

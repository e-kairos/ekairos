import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";
import { ComponentPreview } from "@/components/ekairos/docs/component-preview";
import {
  FileChipArtifactPreview,
  FileChipStatesPreview,
  FileIconRowPreview,
} from "../../_previews";

export const metadata = {
  title: "PromptFileChip | Ekairos Registry",
  description: "The attachment chip: file type, name, upload status and a remove affordance.",
};

export default function PromptFileChipDocPage() {
  return (
    <DocPage
      eyebrow="events / components / prompt-file-chip"
      title="PromptFileChip"
      lead={
        <>
          The simplest way to think about it: <strong className="text-foreground">one chip per
          attachment</strong>. It shows the right file icon, truncates long names behind a tooltip,
          spins while uploading, flags errors, and offers a remove button — the same chip the{" "}
          <InlineCode>Prompt</InlineCode> renders, available standalone.
        </>
      }
    >
      <Section title="Preview">
        <ComponentPreview
          align="start"
          minHeight="10rem"
          code={`<PromptFileChip
  file={{ id: "c1", name: "quarterly-report.pdf", size: "2.4 MB", type: "application/pdf", status: "done" }}
  onRemove={(id) => remove(id)}
/>
<PromptFileChip file={{ id: "c2", name: "site-photos.zip", size: "18 MB", status: "uploading" }} />
<PromptFileChip file={{ id: "c3", name: "broken-upload.csv", status: "error" }} onRemove={remove} />`}
        >
          <FileChipStatesPreview />
        </ComponentPreview>
      </Section>

      <Section title="Install">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/prompt-file-chip.json`}</Code>
        <Callout>
          source in repo — publishing to the registry endpoint is in progress.
        </Callout>
      </Section>

      <Section title="Start simple: a file with a status">
        <p>
          Pass a <InlineCode>PromptAttachment</InlineCode> object. The <InlineCode>status</InlineCode>{" "}
          field drives the chip: <InlineCode>uploading</InlineCode> shows a spinner,{" "}
          <InlineCode>done</InlineCode> shows the file-type icon, <InlineCode>error</InlineCode> adds
          an inline error label. Providing <InlineCode>onRemove</InlineCode> adds the × button:
        </p>
        <Code title="basic">{`import PromptFileChip from "@/components/ekairos/events/prompt/prompt-file-chip";

<PromptFileChip
  file={{ id: "a1", name: "tender-spec.pdf", size: "1.2 MB", type: "application/pdf", status: "done" }}
  onRemove={(id) => removeAttachment(id)}
/>`}</Code>
      </Section>

      <Section title="Then: artifact-context chips">
        <p>
          Set <InlineCode>kind: &quot;artifact-context&quot;</InlineCode> for virtual attachments —
          things pinned from the conversation rather than uploaded files. They get an accent
          treatment, and an <InlineCode>onPress</InlineCode> handler makes the chip clickable (e.g.
          jump back to the artifact in the thread):
        </p>
        <ComponentPreview
          align="start"
          minHeight="10rem"
          code={`<PromptFileChip
  file={{
    id: "art1",
    name: "Revenue chart (in thread)",
    status: "done",
    kind: "artifact-context",
    onPress: () => scrollToArtifact(),
  }}
  onRemove={remove}
/>`}
        >
          <FileChipArtifactPreview />
        </ComponentPreview>
      </Section>

      <Section title="Bonus: FileIcon">
        <p>
          The chip resolves its icon through <InlineCode>FileIcon</InlineCode>, a tiny component that
          maps extension or MIME type to a colored lucide icon. It ships separately
          (<InlineCode>file-icon.json</InlineCode>) and is handy anywhere you list files:
        </p>
        <ComponentPreview
          align="start"
          minHeight="8rem"
          code={`import { FileIcon } from "@/components/ekairos/events/prompt/file-icon";

<FileIcon name="report.pdf" />
<FileIcon name="data.xlsx" />
<FileIcon name="photo.png" />`}
        >
          <FileIconRowPreview />
        </ComponentPreview>
      </Section>

      <Section title="Props">
        <PropsTable
          rows={[
            { name: "file", type: "PromptAttachment", required: true, description: "The attachment to render (see fields below)." },
            { name: "onRemove", type: "(id: string) => void", description: "Adds the remove button; called with the attachment id." },
            { name: "file.id", type: "string", required: true, description: "Stable id, used as the remove handle." },
            { name: "file.name", type: "string", required: true, description: "File name; truncated with a tooltip when long." },
            { name: "file.status", type: '"uploading" | "done" | "error"', required: true, description: "Drives spinner, icon and error label." },
            { name: "file.size", type: "string", description: "Preformatted size label (e.g. “1.2 MB”)." },
            { name: "file.type", type: "string", description: "MIME type, used to pick the icon." },
            { name: "file.kind", type: '"file" | "artifact-context"', description: "Artifact-context chips get the accent style." },
            { name: "file.onPress", type: "() => void", description: "Makes the chip body clickable." },
          ]}
        />
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            { href: "/events/docs/components/prompt", label: "Prompt", description: "The full prompt input that renders these chips for you." },
            { href: "/events/docs/components/message-artifact", label: "MessageArtifact", description: "The artifact shell that artifact-context chips point back to." },
          ]}
        />
      </Section>
    </DocPage>
  );
}

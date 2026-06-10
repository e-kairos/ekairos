import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";
import { ComponentPreview } from "@/components/ekairos/docs/component-preview";
import {
  PromptAttachmentsPreview,
  PromptBasicPreview,
  PromptStatusPreview,
} from "../../_previews";

export const metadata = {
  title: "Prompt | Ekairos Registry",
  description: "A complete agent prompt input: text, files, status, reasoning and stop — fully controlled.",
};

export default function PromptDocPage() {
  return (
    <DocPage
      eyebrow="events / components / prompt"
      title="Prompt"
      lead={
        <>
          The simplest way to think about it: <strong className="text-foreground">a textarea that
          already knows how agents work</strong>. You own the value; it handles attachments, paste,
          drag &amp; drop, the busy/streaming states and the stop button — everything around the text
          that you would otherwise rebuild for every chat surface.
        </>
      }
    >
      <Section title="Preview">
        <ComponentPreview
          align="start"
          minHeight="14rem"
          code={`const [value, setValue] = useState("");

<Prompt
  value={value}
  onChange={setValue}
  onSubmit={(e) => {
    e.preventDefault();
    send(value);
    setValue("");
  }}
/>`}
        >
          <PromptBasicPreview />
        </ComponentPreview>
      </Section>

      <Section title="Install">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/prompt.json`}</Code>
        <Callout>
          source in repo — publishing to the registry endpoint is in progress.
        </Callout>
      </Section>

      <Section title="Start simple: a controlled input">
        <p>
          <InlineCode>Prompt</InlineCode> is fully controlled — give it <InlineCode>value</InlineCode>,{" "}
          <InlineCode>onChange</InlineCode> and <InlineCode>onSubmit</InlineCode> and it works like a
          form. Enter submits, Shift+Enter inserts a newline, and the send button only enables when
          there is something to send:
        </p>
        <Code title="basic">{`import { Prompt } from "@/components/ekairos/events/prompt/prompt";

const [value, setValue] = useState("");

<Prompt value={value} onChange={setValue} onSubmit={handleSubmit} />`}</Code>
      </Section>

      <Section title="Then: reflect agent status">
        <p>
          Pass <InlineCode>status</InlineCode> and the prompt mirrors the turn lifecycle — the status
          dot and label change, controls lock while busy, and when <InlineCode>onStop</InlineCode> is
          provided the send button becomes a stop button during streaming. Toggle the states here:
        </p>
        <ComponentPreview
          align="start"
          minHeight="14rem"
          code={`<Prompt
  value={value}
  onChange={setValue}
  onSubmit={handleSubmit}
  status="streaming" // "idle" | "submitted" | "streaming" | "error"
  onStop={() => abortTurn()}
/>`}
        >
          <PromptStatusPreview />
        </ComponentPreview>
      </Section>

      <Section title="Finally: attachments">
        <p>
          Provide <InlineCode>attachments</InlineCode> plus <InlineCode>onFilesSelected</InlineCode> /{" "}
          <InlineCode>onRemoveAttachment</InlineCode> and the prompt grows an attachment strip. Files
          arrive from the paperclip button, from pasting, and from drag &amp; drop — large pasted text
          is automatically converted into a <InlineCode>.txt</InlineCode> attachment. Try removing or
          adding files:
        </p>
        <ComponentPreview
          align="start"
          minHeight="14rem"
          code={`<Prompt
  value={value}
  onChange={setValue}
  onSubmit={handleSubmit}
  attachments={attachments}
  onFilesSelected={(files) => upload(files)}
  onRemoveAttachment={(id) => remove(id)}
  hasNonTextSendPayload={attachments.length > 0}
/>`}
        >
          <PromptAttachmentsPreview />
        </ComponentPreview>
        <Callout>
          The upload itself stays in your hands: <InlineCode>onFilesSelected</InlineCode> hands you
          the files, you update <InlineCode>attachments</InlineCode> with{" "}
          <InlineCode>status: &quot;uploading&quot; → &quot;done&quot;</InlineCode> as your storage
          confirms.
        </Callout>
      </Section>

      <Section title="Props">
        <PropsTable
          rows={[
            { name: "value", type: "string", required: true, description: "Controlled text value." },
            { name: "onChange", type: "(value: string) => void", required: true, description: "Called with the next text value." },
            { name: "onSubmit", type: "(e: FormEvent) => void", required: true, description: "Form submit handler (Enter or send button)." },
            { name: "status", type: '"idle" | "submitted" | "streaming" | "error"', description: "Turn lifecycle. Locks controls while busy and drives the status label." },
            { name: "onStop", type: "() => void", description: "When set and status is streaming, the send button becomes a stop button." },
            { name: "attachments", type: "PromptAttachment[]", description: "Attachment chips rendered above the textarea." },
            { name: "onFilesSelected", type: "(files: FileList | File[]) => void", description: "Receives files from the attach button, paste and drag & drop." },
            { name: "onRemoveAttachment", type: "(id: string) => void", description: "Shows a remove button on each chip." },
            { name: "isUploading", type: "boolean", description: "Marks the prompt busy and disables send while uploads finish." },
            { name: "hasNonTextSendPayload", type: "boolean", description: "Allow sending with empty text (e.g. attachments only)." },
            { name: "reasoningLevel / onChangeReasoning", type: '"off" | "low" | "medium" | "high"', description: "Controlled reasoning-effort selector in the toolbar." },
            { name: "webSearch / onToggleWeb", type: "boolean / () => void", description: "Controlled web-search toggle in the toolbar." },
            { name: "onToggleVoice", type: "() => void", description: "Shows the voice button when provided." },
            { name: "density", type: '"default" | "compact"', description: "Compact trims padding for embedded / floating chats." },
            { name: "contextLabel", type: "string", description: "Idle status text (e.g. the active context name)." },
            { name: "placeholder / disabled / inputDisabled / className", type: "—", description: "Standard input affordances." },
          ]}
        />
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            { href: "/events/docs/components/prompt-file-chip", label: "PromptFileChip", description: "The attachment chip the prompt renders — usable on its own." },
            { href: "/events/docs/components/context-activity-indicator", label: "ContextActivityIndicator", description: "Pair the prompt with a live activity readout." },
          ]}
        />
      </Section>
    </DocPage>
  );
}

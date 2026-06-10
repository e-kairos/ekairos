import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";
import { ComponentPreview } from "@/components/ekairos/docs/component-preview";
import { ComposerBasicPreview, ComposerMultiPreview } from "../_previews";

export const metadata = {
  title: "ChannelComposer | Ekairos Registry",
  description: "The box your users type in — and the only piece wired to your own endpoint.",
};

export default function ChannelComposerDocPage() {
  return (
    <DocPage
      eyebrow="channel / components / channel-composer"
      title="ChannelComposer"
      lead={
        <>
          The simplest way to think about it: <strong className="text-foreground">the box your
          users type in — and the only piece wired to your own endpoint</strong>. Pick a channel,
          write, hit Enter. The composer POSTs to your send route; delivery and persistence
          happen server-side, and the timeline updates reactively.
        </>
      }
    >
      <Section title="Preview">
        <ComponentPreview
          align="start"
          code={`<ChannelComposer endpoint="/api/examples/channel/send" channels={["web"]} />`}
        >
          <ComposerBasicPreview />
        </ComponentPreview>
        <Callout>
          This preview actually works — type something and send it. It posts to this site&apos;s
          demo endpoint, exactly like it would post to yours.
        </Callout>
      </Section>

      <Section title="Install">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/channel-composer.json`}</Code>
      </Section>

      <Section title="Start simple: one channel, one endpoint">
        <p>
          The minimum is an <InlineCode>endpoint</InlineCode>. With a single channel (the
          default is <InlineCode>[&quot;web&quot;]</InlineCode>) there&apos;s no picker — just
          the textarea and the send button. Enter sends, Shift+Enter makes a new line:
        </p>
        <Code title="basic">{`import { ChannelComposer } from "@/components/ekairos/channel/channel-composer";

<ChannelComposer endpoint="/api/channel/send" contextId={thread.contextId} />`}</Code>
      </Section>

      <Section title="Then: multiple channels">
        <p>
          Pass more than one channel and a badge picker appears above the textarea — the user
          chooses where the message goes out:
        </p>
        <ComponentPreview
          align="start"
          code={`<ChannelComposer
  endpoint="/api/examples/channel/send"
  channels={["web", "whatsapp", "email"]}
/>`}
        >
          <ComposerMultiPreview />
        </ComponentPreview>
      </Section>

      <Section title="Finally: wire it to your endpoint">
        <p>
          This is the one piece of custom code your app owns. The composer sends a single JSON
          POST, and your route calls the channel domain server-side (and triggers the agent
          reaction if you want one):
        </p>
        <Code title="what the composer sends">{`POST /api/channel/send
content-type: application/json

{
  "channel": "whatsapp",
  "text": "Tomo el pedido: 200 cascos IRAM 3620.",
  "contextId": "ctx_...",   // optional
  "threadKey": "thread_..." // optional
}`}</Code>
        <p>
          A non-2xx response rejects the send and fires <InlineCode>onError</InlineCode>; on
          success the textarea clears and <InlineCode>onSent</InlineCode> fires with the channel
          and text. The full server-side recipe lives in the send guide below.
        </p>
      </Section>

      <Section title="Props">
        <PropsTable
          rows={[
            { name: "endpoint", type: "string", required: true, description: "Your send route. Receives POST { channel, text, contextId?, threadKey? } as JSON." },
            { name: "contextId", type: "string", description: "Agent context the message belongs to; forwarded in the POST body." },
            { name: "threadKey", type: "string", description: "Thread key forwarded in the POST body." },
            { name: "channels", type: "string[]", description: "Channels the user can send through. Default: [\"web\"]. More than one shows the badge picker." },
            { name: "placeholder", type: "string", description: "Textarea placeholder. Default: \"Send a message\"." },
            { name: "onSent", type: "({ channel, text }) => void", description: "Called after a successful send." },
            { name: "onError", type: "(error: Error) => void", description: "Called when the endpoint fails or the request throws." },
            { name: "className", type: "string", description: "Extra classes for the form." },
          ]}
        />
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            { href: "/channel/docs/guides/send", label: "Send guide", description: "Build the endpoint this composer posts to." },
            { href: "/channel/docs/components/channel-timeline", label: "ChannelTimeline", description: "Show the conversation the composer writes into." },
          ]}
        />
      </Section>
    </DocPage>
  );
}

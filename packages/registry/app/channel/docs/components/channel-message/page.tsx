import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";
import { ComponentPreview } from "@/components/ekairos/docs/component-preview";
import { BubbleBasicPreview, BubbleChannelsPreview } from "../_previews";

export const metadata = {
  title: "ChannelMessageBubble | Ekairos Registry",
  description: "One message, rendered the same way no matter the platform.",
};

export default function ChannelMessageDocPage() {
  return (
    <DocPage
      eyebrow="channel / components / channel-message"
      title="ChannelMessageBubble"
      lead={
        <>
          The simplest way to think about it: <strong className="text-foreground">one message,
          rendered the same way no matter the platform</strong>. It takes a canonical{" "}
          <InlineCode>channel_messages</InlineCode> record and draws the bubble: inbound on the
          left, outbound on the right, with the author, the platform badge, status and time in
          the header.
        </>
      }
    >
      <Section title="Preview">
        <ComponentPreview
          align="start"
          code={`<ChannelMessageBubble message={inbound} />
<ChannelMessageBubble message={outbound} />`}
        >
          <BubbleBasicPreview />
        </ComponentPreview>
      </Section>

      <Section title="Install">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/channel-message.json`}</Code>
      </Section>

      <Section title="Start simple: one inbound message">
        <p>
          Hand it a message and it figures out the rest. <InlineCode>direction</InlineCode>{" "}
          decides the side, <InlineCode>role</InlineCode> decides the tone, and the badge tells
          the platform:
        </p>
        <Code title="basic">{`import { ChannelMessageBubble } from "@/components/ekairos/channel/channel-message";

<ChannelMessageBubble
  message={{
    id: "m1",
    channel: "whatsapp",
    direction: "inbound",
    role: "user",
    participant: "+54 9 11 5555-0147",
    text: "Hola! Necesito cotizar 200 cascos certificados.",
    createdAt: new Date().toISOString(),
  }}
/>`}</Code>
      </Section>

      <Section title="Then: across channels">
        <p>
          The same component renders an email reply, a slack approval, an outbound RFQ — because
          it reads the canonical model, not provider payloads. And when your whole view is a
          single channel, pass <InlineCode>hideChannel</InlineCode> to drop the badge (the email
          below does exactly that):
        </p>
        <ComponentPreview
          align="start"
          code={`<ChannelMessageBubble message={emailReply} />
<ChannelMessageBubble message={slackApproval} />
<ChannelMessageBubble message={outboundEmail} hideChannel />`}
        >
          <BubbleChannelsPreview />
        </ComponentPreview>
      </Section>

      <Section title="What it actually renders">
        <p>
          The body comes from the canonical content: <InlineCode>text</InlineCode> when present,
          otherwise it joins the <InlineCode>parts</InlineCode> with{" "}
          <InlineCode>type: &quot;text&quot;</InlineCode>. The header line shows the author
          (<InlineCode>participant</InlineCode>, falling back to the role), the platform badge,
          the delivery <InlineCode>status</InlineCode> if any, and the local time from{" "}
          <InlineCode>createdAt</InlineCode>.
        </p>
        <Callout>
          Provider-specific payloads never reach this component — normalization happens at
          ingestion. That&apos;s why one bubble works for every channel, including custom ones.
        </Callout>
      </Section>

      <Section title="Props">
        <PropsTable
          rows={[
            { name: "message", type: "ChannelMessage", required: true, description: "Canonical channel_messages record: channel, direction, role, participant, status, text or parts, createdAt." },
            { name: "hideChannel", type: "boolean", description: "Hide the channel badge (e.g. in single-channel views)." },
            { name: "className", type: "string", description: "Extra classes for the bubble row." },
          ]}
        />
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            { href: "/channel/docs/components/channel-timeline", label: "ChannelTimeline", description: "Many bubbles in order: the whole conversation across channels." },
          ]}
        />
      </Section>
    </DocPage>
  );
}

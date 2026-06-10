import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";
import { ComponentPreview } from "@/components/ekairos/docs/component-preview";
import { BadgeRowPreview } from "../_previews";

export const metadata = {
  title: "ChannelBadge | Ekairos Registry",
  description: "A tiny chip that tells you where a message came from.",
};

export default function ChannelBadgeDocPage() {
  return (
    <DocPage
      eyebrow="channel / components / channel-badge"
      title="ChannelBadge"
      lead={
        <>
          The simplest way to think about it: <strong className="text-foreground">a tiny chip
          that tells you where a message came from</strong>. Whatsapp gets its green dot, slack
          its red one, email its amber one — so when channels mix in a single conversation, the
          eye never loses track of the platform.
        </>
      }
    >
      <Section title="Preview">
        <ComponentPreview code={`<ChannelBadge channel="whatsapp" />`}>
          <BadgeRowPreview />
        </ComponentPreview>
        <Callout>
          Notice <InlineCode>sms</InlineCode> at the end: it&apos;s not in the built-in palette,
          yet it renders fine with a neutral accent. The channel prop is an open union — any
          string works.
        </Callout>
      </Section>

      <Section title="Install">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/channel-badge.json`}</Code>
      </Section>

      <Section title="Start simple: one badge">
        <p>
          Pass the channel name and you&apos;re done. Known platforms (web, email, whatsapp,
          slack, teams, gchat, discord, telegram) get their signature accent color:
        </p>
        <Code title="basic">{`import { ChannelBadge } from "@/components/ekairos/channel/channel-badge";

<ChannelBadge channel="whatsapp" />`}</Code>
      </Section>

      <Section title="Custom channels just work">
        <p>
          Because <InlineCode>channel</InlineCode> is a plain <InlineCode>string</InlineCode>,
          you don&apos;t need to wait for this component to learn about your platform. An
          internal channel, a niche provider, anything — unknown values fall back to a neutral
          gray dot instead of breaking:
        </p>
        <Code title="custom">{`<ChannelBadge channel="sms" />
<ChannelBadge channel="my-internal-bus" />`}</Code>
        <p>
          This matters because the canonical message model is open too: a new ingestion channel
          shows up in your timeline correctly labeled, with zero UI changes.
        </p>
      </Section>

      <Section title="Props">
        <PropsTable
          rows={[
            { name: "channel", type: "string", required: true, description: "Channel kind: web, email, whatsapp, slack, teams, gchat, discord, telegram — or any custom string (neutral accent)." },
            { name: "className", type: "string", description: "Extra classes for the chip." },
          ]}
        />
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            { href: "/channel/docs/components/channel-message", label: "ChannelMessageBubble", description: "The badge in context: one message bubble per canonical record." },
          ]}
        />
      </Section>
    </DocPage>
  );
}

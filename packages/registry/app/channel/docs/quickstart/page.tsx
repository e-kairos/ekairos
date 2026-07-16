import { Callout, Code, DocPage, InlineCode, NextLinks, Section } from "../_kit";

export const metadata = {
  title: "Channel — Quickstart | Ekairos Registry",
  description: "Schema, platforms, webhook and timeline in four steps.",
};

export default function ChannelQuickstartPage() {
  return (
    <DocPage
      eyebrow="channel / quickstart"
      title="Multichannel in four steps."
      lead={
        <>
          From zero to a live multichannel thread: push the schema, boot the platforms, mount one
          webhook, render one component. Sending is a fifth, optional step — inbound conversations
          work without it.
        </>
      }
    >
      <Section title="1 — Install and push the schema">
        <Code title="terminal">{`pnpm add @ekairos/channel
npx instant-cli@latest push schema`}</Code>
        <p>
          The channel domain composes the events domain, so pushing{" "}
          <InlineCode>channelDomain</InlineCode> gives you everything:
        </p>
        <Code title="instant.schema.ts">{`import { channelDomain } from "@ekairos/channel/schema";

export default channelDomain.toInstantSchema();`}</Code>
        <Callout>
          Already have an app domain? Compose instead:{" "}
          <InlineCode>domain(&quot;app&quot;).includes(channelDomain).withSchema(&#123;...&#125;)</InlineCode>. Your
          entities and the channel entities live in the same InstantDB app — that is what makes the
          UI plug &amp; play.
        </Callout>
      </Section>

      <Section title="2 — Boot the platforms">
        <Code title="lib/channels.ts">{`import { Context } from "@ekairos/context";
import { bindReaction, createChannels } from "@ekairos/channel/platforms";
import { runtime } from "@/lib/runtime";
import { support, answerInbound } from "@/lib/support-domain";

const react = bindReaction({
  runtime,
  reaction: answerInbound,
  event: (inbound) =>
    support.events.messageReceived({
      text: inbound.message.text ?? "",
      participant: inbound.message.participant,
    }).link({ message: inbound.message.id }),
  replyText: (effect) => effect.payload.reply,
});

export const channels = await createChannels({
  runtime,
  userName: "ekairos",
  platforms: {
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    },
    telegram: { botToken: process.env.TELEGRAM_BOT_TOKEN! },
  },
  resolveContextId: async ({ channel, threadKey }) => {
    const context = await Context(runtime).create({
      key: \`\${channel}:\${threadKey}\`,
    });
    return context.id;
  },
  react,
});`}</Code>
        <p>
          Each configured platform needs its adapter package installed once (
          <InlineCode>pnpm add @chat-adapter/slack</InlineCode>, etc.) — they are optional peers, so
          you only carry the platforms you use. Credentials and per-platform setup live in{" "}
          <a className="underline underline-offset-4" href="/channel/docs/guides/platform-setup">
            Platform setup
          </a>
          .
        </p>
      </Section>

      <Section title="3 — Mount the webhook">
        <Code title="app/api/channels/[platform]/route.ts">{`import { channels } from "@/lib/channels";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const handler = channels.webhooks[platform];
  if (!handler) {
    return new Response("unknown platform", { status: 404 });
  }
  return handler(request);
}`}</Code>
        <p>
          One route serves every platform. Point each platform&apos;s webhook URL at{" "}
          <InlineCode>/api/channels/&lt;platform&gt;</InlineCode> and the inbound pipeline is live:
          message → canonical record → agent reaction → reply.
        </p>
      </Section>

      <Section title="4 — Render the timeline">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/channel-timeline.json`}</Code>
        <Code title="app/threads/[key]/page.tsx">{`"use client";

import type { ChannelMessage } from "@ekairos/channel";
import { ChannelTimeline } from "@/components/ekairos/channel/channel-timeline";

export function ThreadConversation({ messages }: { messages: ChannelMessage[] }) {
  return <ChannelTimeline messages={messages} />;
}`}</Code>
        <p>
          Pass canonical <InlineCode>channel_messages</InlineCode> from your read path. The timeline
          renders the same shape for every platform, so whatsapp, email and web messages remain one
          ordered conversation.
        </p>
      </Section>

      <Section title="5 — (Optional) Send from your product">
        <p>
          Outbound from the UI is the one endpoint you own — see{" "}
          <a className="underline underline-offset-4" href="/channel/docs/guides/send">
            Send messages
          </a>
          . Drop in <InlineCode>ChannelComposer</InlineCode> and point it at that endpoint.
        </p>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/concepts/messages",
              label: "Concepts: Messages",
              description: "What lands in channel_messages and how it links to the context.",
            },
            {
              href: "/channel/docs/guides/webhooks",
              label: "Mount webhooks",
              description: "Fast responses, background processing, platform verification.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

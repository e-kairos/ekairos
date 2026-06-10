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
        <Code title="terminal">{`pnpm add @ekairos/channel @ekairos/agent
npx instant-cli@latest push schema`}</Code>
        <p>
          The channel domain composes the events domain, so pushing{" "}
          <InlineCode>agentDomain</InlineCode> (which includes channel) gives you everything:
        </p>
        <Code title="instant.schema.ts">{`import { agentDomain } from "@ekairos/agent/schema";

export default agentDomain.toInstantSchema();`}</Code>
        <Callout>
          Already have an app domain? Compose instead:{" "}
          <InlineCode>domain(&quot;app&quot;).includes(agentDomain).withSchema(&#123;...&#125;)</InlineCode>. Your
          entities and the channel entities live in the same InstantDB app — that is what makes the
          UI plug &amp; play.
        </Callout>
      </Section>

      <Section title="2 — Boot the platforms">
        <Code title="lib/channels.ts">{`import { createChannels } from "@ekairos/channel/platforms";
import { db } from "@/lib/db"; // InstantDB admin client

export const channels = await createChannels({
  db,
  userName: "ekairos",
  platforms: {
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    },
    telegram: { botToken: process.env.TELEGRAM_BOT_TOKEN! },
  },
  resolveContextId: async ({ channel, threadKey }) => {
    // one platform conversation = one agent thread
    const thread = await ensureThread({ key: \`\${channel}:\${threadKey}\` });
    return thread.contextId;
  },
  react: async (inbound) => {
    const reaction = await reactOnThread(inbound.contextId, inbound.message);
    return reaction.text; // posted back on the same platform, persisted outbound
  },
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

import { db } from "@/lib/db.client"; // InstantDB react client
import { ChannelTimeline } from "@/components/ekairos/channel/channel-timeline";

export function ThreadConversation({ contextId }: { contextId: string }) {
  return <ChannelTimeline db={db} contextId={contextId} />;
}`}</Code>
        <p>
          No fetch, no API route, no props plumbing: the component queries{" "}
          <InlineCode>channel_messages</InlineCode> reactively. A whatsapp reply appears in the
          timeline the moment the webhook persists it.
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

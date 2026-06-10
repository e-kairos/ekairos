import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";

export const metadata = {
  title: "Channel — UI components | Ekairos Registry",
  description: "Timeline, message bubble, badge and composer: plug & play over channel_messages.",
};

export default function ChannelComponentsGuidePage() {
  return (
    <DocPage
      eyebrow="channel / guides / components"
      title="UI components."
      lead={
        <>
          Four components, one canonical model. Because every channel persists the same{" "}
          <InlineCode>channel_messages</InlineCode> shape on InstantDB, the components render
          whatsapp, slack and web identically — and they read reactively, so there is no fetch
          layer to build. Install with shadcn, hand them <InlineCode>db</InlineCode> and{" "}
          <InlineCode>contextId</InlineCode>, done.
        </>
      }
    >
      <Section title="The plug & play contract">
        <p>
          Three of the four components are pure render: they take data and draw it.{" "}
          <InlineCode>ChannelTimeline</InlineCode> goes one step further — give it an InstantDB
          react client and a <InlineCode>contextId</InlineCode> and it subscribes to{" "}
          <InlineCode>channel_messages</InlineCode> itself. A telegram reply persisted by the
          webhook appears in the browser the same instant, with no API route, no polling, no state
          management in between. The only component that touches code you own is{" "}
          <InlineCode>ChannelComposer</InlineCode>, because sending is an action your app must
          authorize.
        </p>
      </Section>

      <Section title="ChannelTimeline">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/channel-timeline.json`}</Code>
        <p>
          The whole conversation across every channel, interleaved chronologically with day
          separators. Channels mix freely in one stream because they share one canonical schema.
        </p>
        <PropsTable
          rows={[
            {
              name: "db",
              type: "InstantDB react client | null",
              description: (
                <>
                  When provided with <InlineCode>contextId</InlineCode>, the timeline queries{" "}
                  <InlineCode>channel_messages</InlineCode> reactively via{" "}
                  <InlineCode>db.useQuery</InlineCode>. This is the plug &amp; play path.
                </>
              ),
            },
            {
              name: "contextId",
              type: "string | null",
              description: "Agent context to read the conversation from.",
            },
            {
              name: "messages",
              type: "ChannelMessage[]",
              description: (
                <>
                  Static rows (demos, tests, server snapshots). Used when <InlineCode>db</InlineCode>{" "}
                  is absent.
                </>
              ),
            },
            {
              name: "channels",
              type: "string[]",
              description: "Restrict to specific channels (default: all).",
            },
            { name: "className", type: "string", description: "Extra classes on the root." },
            {
              name: "emptyState",
              type: "ReactNode",
              description: "Rendered when there are no messages.",
            },
          ]}
        />
        <Code title="app/threads/[key]/conversation.tsx">{`"use client";

import { db } from "@/lib/db.client"; // InstantDB react client
import { ChannelTimeline } from "@/components/ekairos/channel/channel-timeline";

export function Conversation({ contextId }: { contextId: string }) {
  return <ChannelTimeline db={db} contextId={contextId} />;
}`}</Code>
        <Callout tone="warning">
          Pass a <strong>stable</strong> <InlineCode>db</InlineCode> reference — the module-level
          client from <InlineCode>init()</InlineCode>, not one created during render. The timeline
          calls <InlineCode>db.useQuery</InlineCode> as a hook, so the client must be the same
          object on every render of a mounted timeline.
        </Callout>
      </Section>

      <Section title="ChannelMessageBubble">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/channel-message.json`}</Code>
        <p>
          One bubble for any canonical message: <InlineCode>direction</InlineCode> decides the
          side, <InlineCode>role</InlineCode> decides the tone, the badge tells the platform. It
          renders the canonical model — never provider payloads — which is why it works for every
          channel, including custom ones.
        </p>
        <PropsTable
          rows={[
            {
              name: "message",
              type: "ChannelMessage",
              required: true,
              description: (
                <>
                  The canonical record. Text comes from <InlineCode>message.text</InlineCode> or,
                  failing that, the text parts in <InlineCode>message.parts</InlineCode>.
                </>
              ),
            },
            { name: "className", type: "string", description: "Extra classes on the root." },
            {
              name: "hideChannel",
              type: "boolean",
              description: "Hide the channel badge (e.g. in single-channel views).",
            },
          ]}
        />
        <Code title="usage">{`<ChannelMessageBubble message={message} hideChannel />`}</Code>
      </Section>

      <Section title="ChannelBadge">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/channel-badge.json`}</Code>
        <p>
          The platform identity chip: a colored dot and the channel name. Known channels (web,
          email, whatsapp, slack, teams, gchat, discord, telegram) get their brand accent; unknown
          channels render with a neutral accent, so custom channels work out of the box.
        </p>
        <PropsTable
          rows={[
            {
              name: "channel",
              type: "string",
              required: true,
              description: "Channel kind: web, email, whatsapp, slack, teams, discord, telegram, ...",
            },
            { name: "className", type: "string", description: "Extra classes on the chip." },
          ]}
        />
        <Code title="usage">{`<ChannelBadge channel="whatsapp" />`}</Code>
      </Section>

      <Section title="ChannelComposer">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/channel-composer.json`}</Code>
        <p>
          Pick the channel, write, send. This is the only component that calls code you own: it
          POSTs <InlineCode>{`{ channel, text, contextId?, threadKey? }`}</InlineCode> as JSON to
          your send endpoint (see{" "}
          <a className="underline underline-offset-4" href="/channel/docs/guides/send">
            Send messages
          </a>
          ) and handles the channel picker, busy state, Enter-to-send and error reporting itself.
          It never writes to InstantDB directly — your endpoint delivers and persists server-side,
          and the timeline updates reactively.
        </p>
        <PropsTable
          rows={[
            {
              name: "endpoint",
              type: "string",
              required: true,
              description:
                "Your send endpoint — the one piece of custom code an app owns for outbound.",
            },
            {
              name: "contextId",
              type: "string",
              description: "Agent context the message belongs to; forwarded in the POST body.",
            },
            {
              name: "threadKey",
              type: "string",
              description: "Platform conversation key; forwarded in the POST body.",
            },
            {
              name: "channels",
              type: "string[]",
              description: (
                <>
                  Channels the user can send through. Defaults to{" "}
                  <InlineCode>[&quot;web&quot;]</InlineCode>; with more than one, a picker appears.
                </>
              ),
            },
            {
              name: "placeholder",
              type: "string",
              description: (
                <>
                  Textarea placeholder. Defaults to <InlineCode>&quot;Send a message&quot;</InlineCode>.
                </>
              ),
            },
            { name: "className", type: "string", description: "Extra classes on the form." },
            {
              name: "onSent",
              type: "({ channel, text }) => void",
              description: "Called after a successful send.",
            },
            {
              name: "onError",
              type: "(error: Error) => void",
              description: "Called when the endpoint responds non-2xx or the request fails.",
            },
          ]}
        />
      </Section>

      <Section title="Compose them: a full inbox">
        <p>
          Timeline plus composer is a complete multichannel inbox — reads are reactive, writes go
          through your endpoint, and the loop closes itself when the webhook persists the reply:
        </p>
        <Code title="app/inbox/[key]/inbox.tsx">{`"use client";

import { db } from "@/lib/db.client";
import { ChannelTimeline } from "@/components/ekairos/channel/channel-timeline";
import { ChannelComposer } from "@/components/ekairos/channel/channel-composer";

export function Inbox({ contextId }: { contextId: string }) {
  return (
    <div className="grid gap-4">
      <ChannelTimeline db={db} contextId={contextId} />
      <ChannelComposer
        endpoint="/api/channels/send"
        contextId={contextId}
        channels={["web", "whatsapp", "email"]}
      />
    </div>
  );
}`}</Code>
        <p>
          That is the entire client. Everything else — delivery, persistence, agent reactions —
          happens in the channel domain on the server.
        </p>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/guides/send",
              label: "Send messages",
              description: "The send endpoint the composer points at.",
            },
            {
              href: "/channel/docs/guides/webhooks",
              label: "Mount webhooks",
              description: "Where inbound messages enter the timeline.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

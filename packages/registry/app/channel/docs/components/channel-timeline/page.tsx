import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";
import { ComponentPreview } from "@/components/ekairos/docs/component-preview";
import { TimelineBasicPreview, TimelineFilteredPreview } from "../_previews";

export const metadata = {
  title: "ChannelTimeline | Ekairos Registry",
  description: "The whole conversation across every channel, in one component.",
};

export default function ChannelTimelineDocPage() {
  return (
    <DocPage
      eyebrow="channel / components / channel-timeline"
      title="ChannelTimeline"
      lead={
        <>
          The simplest way to think about it: <strong className="text-foreground">one scrolling
          conversation, no matter where people wrote from</strong>. A whatsapp message, a supplier
          email and a slack approval show up in the same list, in order, each wearing its platform
          badge.
        </>
      }
    >
      <Section title="Preview">
        <ComponentPreview
          align="start"
          code={`<ChannelTimeline messages={messages} />`}
        >
          <TimelineBasicPreview />
        </ComponentPreview>
      </Section>

      <Section title="Install">
        <Code title="terminal">{`pnpm dlx shadcn@latest add https://registry.ekairos.dev/r/channel-timeline.json`}</Code>
      </Section>

      <Section title="Start simple: a list of messages">
        <p>
          Give it an array of canonical messages and it renders the conversation with day
          separators. No backend, no config — useful for demos, tests and server snapshots:
        </p>
        <Code title="basic">{`import { ChannelTimeline } from "@/components/ekairos/channel/channel-timeline";

<ChannelTimeline messages={messages} />`}</Code>
      </Section>

      <Section title="Then: filter by channel">
        <p>
          Pass <InlineCode>channels</InlineCode> to focus the view — here, toggling platforms live:
        </p>
        <ComponentPreview
          align="start"
          code={`<ChannelTimeline messages={messages} channels={["email"]} />`}
        >
          <TimelineFilteredPreview />
        </ComponentPreview>
      </Section>

      <Section title="Finally: make it live">
        <p>
          This is the real mode. Hand it your InstantDB react client and a context id and the
          timeline becomes a reactive query over <InlineCode>channel_messages</InlineCode> — a
          whatsapp reply appears the moment the webhook persists it. The demo on this site runs
          exactly this against your temporary database:
        </p>
        <Code title="live (plug & play)">{`"use client";
import { db } from "@/lib/db.client"; // InstantDB react client

<ChannelTimeline db={db} contextId={thread.contextId} />`}</Code>
        <Callout>
          Provide <InlineCode>db</InlineCode> from the first render (a stable client instance) —
          the component decides its data source at mount.
        </Callout>
      </Section>

      <Section title="Props">
        <PropsTable
          rows={[
            { name: "db", type: "InstantDB react client", description: "Live mode: reactive query over channel_messages. Takes precedence over messages." },
            { name: "contextId", type: "string | null", description: "Agent context to read the conversation from (live mode)." },
            { name: "messages", type: "ChannelMessage[]", description: "Static rows for demos, tests and snapshots." },
            { name: "channels", type: "string[]", description: "Restrict to specific channels. Default: all." },
            { name: "emptyState", type: "ReactNode", description: "Rendered when there are no visible messages." },
            { name: "className", type: "string", description: "Container class." },
          ]}
        />
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            { href: "/channel/docs/components/channel-composer", label: "ChannelComposer", description: "Add outbound sending under the timeline." },
            { href: "/channel/demo", label: "Live demo", description: "This component running against a real temporary database." },
          ]}
        />
      </Section>
    </DocPage>
  );
}

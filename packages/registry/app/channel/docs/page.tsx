import { Callout, Code, DocPage, InlineCode, NextLinks, Section } from "./_kit";

export const metadata = {
  title: "Channel — Overview | Ekairos Registry",
  description:
    "The channel domain: unified multichannel communication for agent threads, persisted on InstantDB.",
};

export default function ChannelOverviewPage() {
  return (
    <DocPage
      eyebrow="channel / overview"
      title="Every channel. One thread."
      lead={
        <>
          Channel is the communication domain of Ekairos: one canonical message model across web,
          email, whatsapp, slack, teams, discord and telegram, persisted on InstantDB and linked to
          the agent&apos;s context. Your product renders one timeline; the customer answers wherever
          they live.
        </>
      }
    >
      <Section title="The problem it removes">
        <p>
          Every product that talks to people ends up rebuilding the same machinery: a webhook per
          platform, a message table per provider, glue code to show &quot;the conversation&quot; in
          one place, and a fragile mapping between what the agent said and what was actually
          delivered. That machinery is undifferentiated — and it keeps breaking as platforms change.
        </p>
        <p>
          Channel turns all of it into <strong>domain state</strong>. Inbound and outbound messages
          from every platform land as <InlineCode>channel_messages</InlineCode> records on the agent
          thread&apos;s context. Subscriptions, delivery locks and queues persist in the same domain.
          There is no message API to build and no sync job to babysit: UI reads InstantDB
          reactively, and the agent reacts to inbound messages like it reacts to anything else.
        </p>
      </Section>

      <Section title="How it fits the Ekairos domains">
        <Code title="domain composition">{`agent_threads ──one── event_contexts ──many── event_items
                                   │                  │
                                   └─many─ channel_messages ─one┘
                                          (web · email · whatsapp · slack · ...)`}</Code>
        <p>
          The <strong>agent</strong> domain owns the thread — a thin indirection over a context. The{" "}
          <strong>events</strong> domain owns the durable conversation state. Channel adds the
          communication surface: every message that crosses a platform boundary is recorded
          canonically and linked to that same context, so{" "}
          <InlineCode>useThread</InlineCode> returns the whole multichannel conversation with one
          reactive query.
        </p>
      </Section>

      <Section title="What you write vs what you get">
        <p>
          An application owns exactly <strong>two pieces of custom code</strong>:
        </p>
        <Code title="the entire integration surface">{`1. A webhook mount    →  app/api/channels/[platform]/route.ts
2. A send endpoint    →  app/api/channels/send/route.ts`}</Code>
        <p>
          Everything else is provided: platform delivery, canonical persistence, runtime state,
          reactive queries, and plug &amp; play UI components that work the moment the schema is
          pushed — because they query <InlineCode>channel_messages</InlineCode> directly. That is the
          magic: the components depend on a schema, not on your backend.
        </p>
      </Section>

      <Section title="Under the hood">
        <Callout>
          Platform delivery is built on{" "}
          <a className="underline underline-offset-4" href="https://chat-sdk.dev">
            Vercel&apos;s Chat SDK
          </a>{" "}
          — wrapped and contained as an internal of the channel package, including its adapters. You
          configure <strong>platforms</strong>, never the underlying SDK; its runtime state
          (subscriptions, locks, queues) is persisted on InstantDB through channel domain entities.
          Containment is the point: upstream updates are routine dependency bumps that never touch
          your code.
        </Callout>
      </Section>

      <Section title="Start here">
        <NextLinks
          links={[
            {
              href: "/channel/docs/quickstart",
              label: "Quickstart",
              description: "Schema → platforms → webhook → timeline, in four steps.",
            },
            {
              href: "/channel/demo",
              label: "Live demo",
              description: "A simulated thread spanning whatsapp, email, slack and web.",
            },
            {
              href: "/channel/docs/concepts/messages",
              label: "Concepts: Messages",
              description: "The canonical model every channel maps into.",
            },
            {
              href: "/channel/docs/guides/components",
              label: "UI components",
              description: "ChannelTimeline & friends — plug & play over the schema.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

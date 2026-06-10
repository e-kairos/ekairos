import { Callout, Code, DocPage, InlineCode, NextLinks, Section } from "../../_kit";

export const metadata = {
  title: "Channel — Threads & contexts | Ekairos Registry",
  description:
    "The agent_threads indirection, resolveContextId as the mapping point, and how one context carries the whole multichannel conversation.",
};

export default function ChannelThreadsConceptPage() {
  return (
    <DocPage
      eyebrow="channel / concepts"
      title="Threads &amp; contexts"
      lead={
        <>
          A thread is the unit your application talks to; a context is the unit everything else
          hangs off. The thin indirection between them — <InlineCode>agent_threads</InlineCode>{" "}
          pointing at <InlineCode>event_contexts</InlineCode> — is what lets one conversation span
          web, slack and whatsapp without your code ever merging anything.
        </>
      }
    >
      <Section title="The indirection">
        <p>
          The agent domain adds exactly one entity, and it is deliberately thin:
        </p>
        <Code title="@ekairos/agent/schema">{`agent_threads: i.entity({
  key: i.string().optional().unique().indexed(),
  title: i.string().optional(),
  status: i.string().optional().indexed(),
  metadata: i.json().optional(),
  createdAt: i.date().indexed(),
  updatedAt: i.date().optional(),
}),

// the one link that matters
agent_threadsContext: {
  forward: { on: "agent_threads", has: "one", label: "context" },
  reverse: { on: "event_contexts", has: "one", label: "thread" },
},`}</Code>
        <p>
          A thread owns no items, no messages, no executions — it owns a{" "}
          <strong>context</strong>, one-to-one. The context (from the events domain) is where the
          actual conversation state lives: agent items, executions, steps, parts, and — via the
          channel domain&apos;s links — every canonical channel message. The thread is the stable,
          addressable handle on top: it has a unique <InlineCode>key</InlineCode> your application
          chooses, a title for lists, a status for dashboards.
        </p>
        <p>
          The payoff of the indirection: the application-facing identity (the key, the title) and
          the event-sourced machinery (the context) evolve independently. Renaming a thread touches
          one row; the context engine underneath never knows threads exist.
        </p>
      </Section>

      <Section title="One conversation, one thread, one context">
        <p>
          The channel runtime hands you a stable <InlineCode>threadKey</InlineCode> per platform
          conversation. <InlineCode>resolveContextId</InlineCode> is the single mapping point where
          that platform identity becomes an agent identity:
        </p>
        <Code title="the mapping point">{`resolveContextId: async ({ channel, threadKey }) => {
  // platform conversation -> agent thread (idempotent: unique key)
  const thread = await ensureThread({ key: \`\${channel}:\${threadKey}\` });
  // agent thread -> agent context (the one-to-one link)
  return thread.contextId;
},`}</Code>
        <p>
          Because <InlineCode>agent_threads.key</InlineCode> is unique and the function is
          idempotent, the equation holds for the lifetime of the conversation:{" "}
          <strong>one platform conversation = one thread = one context</strong>. The hundredth
          telegram message in a chat resolves to the same context as the first. And because the
          mapping is yours, so are the exceptions — route two platforms into one shared context, or
          shard a noisy channel into per-topic contexts, by changing one function.
        </p>
      </Section>

      <Section title="The composition">
        <Code title="how the domains stack">{`            agent_threads                     <- @ekairos/agent
            key: "telegram:chat-88231"           the handle your app addresses
                  |
                  | context (one-to-one)
                  v
            event_contexts                    <- @ekairos/events
            the durable conversation
                  |
        +---------+-----------------+
        | items (many)              | channelMessages (many)
        v                           v
   event_items                channel_messages    <- @ekairos/channel
   the agent timeline:        the canonical wire:
   - user input items         - inbound  (whatsapp, slack, ...)
   - assistant reactions      - outbound (replies, broadcasts)
   - executions/steps/parts   - status, externalId, raw payload`}</Code>
        <p>
          Each domain composes the one below it: <InlineCode>agentDomain</InlineCode> includes{" "}
          <InlineCode>channelDomain</InlineCode>, which includes <InlineCode>eventsDomain</InlineCode>.
          Pushing the agent schema gives you the whole stack in one InstantDB app — which is exactly
          why a single query can walk all of it.
        </p>
      </Section>

      <Section title="Items and channel messages share the context">
        <p>
          The two collections answer different questions about the same conversation.{" "}
          <InlineCode>event_items</InlineCode> is the <strong>agent&apos;s timeline</strong>: what
          triggered a reaction, what the reactor produced, with full execution provenance
          (executions, steps, parts). <InlineCode>channel_messages</InlineCode> is the{" "}
          <strong>wire record</strong>: what actually crossed each channel, in which direction, with
          what delivery status and provider payload.
        </p>
        <p>
          They overlap without duplicating: an inbound whatsapp text exists as a channel message
          (the wire fact) and produces a trigger item (the agent fact); the agent&apos;s reply
          exists as an item (the reasoning fact) and as an outbound channel message (the delivery
          fact). The optional <InlineCode>item</InlineCode> link on{" "}
          <InlineCode>channel_messages</InlineCode> pairs them, and the shared context keeps both
          collections in one place — no joins across databases, no reconciliation jobs.
        </p>
      </Section>

      <Section title="One query, the whole conversation">
        <p>
          Because everything hangs off one context, reading a conversation is one reactive InstantDB
          query, not an aggregation:
        </p>
        <Code title="the shape useThread subscribes to">{`{
  agent_threads: {
    $: { where: { key: "telegram:chat-88231" } },
    context: {
      items: {},            // the agent timeline
      channelMessages: {},  // every message, every platform
    },
  },
}`}</Code>
        <p>
          This is why <InlineCode>useThread</InlineCode> returns the complete multichannel
          conversation as one snapshot — <InlineCode>&#123; thread, context, items, messages
          &#125;</InlineCode> — and why it stays live for free. A whatsapp inbound persisted by the
          webhook, an assistant item written by the reactor, a slack reply marked{" "}
          <InlineCode>delivered</InlineCode>: each is a write to an entity already inside the
          subscribed query, so every connected client repaints instantly. There is no endpoint to
          call and nothing to merge client-side; the data model already did the merging.
        </p>
        <Callout>
          Resist the urge to query <InlineCode>channel_messages</InlineCode> by{" "}
          <InlineCode>participant</InlineCode> or <InlineCode>channel</InlineCode> when you mean a
          conversation. The context is the conversation boundary; everything else is a filter
          within it.
        </Callout>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/concepts/messages",
              label: "Messages",
              description: "The canonical channel_messages model, field by field.",
            },
            {
              href: "/channel/docs/reference/use-thread",
              label: "useThread integration",
              description: "Consuming the thread snapshot and live events in your UI.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

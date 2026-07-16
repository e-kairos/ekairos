import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";

export const metadata = {
  title: "Channel — Schema | Ekairos Registry",
  description:
    "API reference for the channel domain schema: entities, links, composition, and how to push it.",
};

export default function SchemaReferencePage() {
  return (
    <DocPage
      eyebrow="channel / reference"
      title="Schema"
      lead={
        <>
          <InlineCode>channelDomain</InlineCode> declares one canonical message entity for every
          communication channel, four internal runtime entities, and two links into the events
          domain. Provider-specific records (a Resend email, a Twilio message) stay in app/provider
          domains and link back to <InlineCode>channel_messages</InlineCode> via{" "}
          <InlineCode>externalId</InlineCode>/<InlineCode>raw</InlineCode>.
        </>
      }
    >
      <Section title="channelDomain">
        <Code title="@ekairos/channel/schema">{`import { channelDomain } from "@ekairos/channel/schema";

// domain("channel").includes(contextDomain).withSchema({ entities, links, rooms })`}</Code>
        <p>
          The domain is named <InlineCode>channel</InlineCode> and composes{" "}
          <InlineCode>contextDomain</InlineCode>, so it carries{" "}
          <InlineCode>context_contexts</InlineCode> and <InlineCode>context_events</InlineCode> with it —
          that is what the links below attach to.
        </p>
      </Section>

      <Section title="channel_messages">
        <p>
          The canonical message crossing any channel. This is the one <strong>public</strong>{" "}
          entity: your UI queries it, your endpoints write to it.
        </p>
        <PropsTable
          rows={[
            {
              name: "channel",
              type: "string — indexed",
              required: true,
              description: (
                <>
                  Channel kind: <InlineCode>web</InlineCode>, <InlineCode>email</InlineCode>,{" "}
                  <InlineCode>whatsapp</InlineCode>, or any custom kind.
                </>
              ),
            },
            {
              name: "direction",
              type: "string — indexed",
              required: true,
              description: (
                <>
                  <InlineCode>inbound</InlineCode> or <InlineCode>outbound</InlineCode>, relative to
                  your system.
                </>
              ),
            },
            {
              name: "role",
              type: "string — optional, indexed",
              description: (
                <>
                  Conversational role: <InlineCode>user</InlineCode>,{" "}
                  <InlineCode>assistant</InlineCode>, or <InlineCode>system</InlineCode>.
                </>
              ),
            },
            {
              name: "text",
              type: "string — optional",
              description: <>Plain-text body of the message.</>,
            },
            {
              name: "parts",
              type: "json — optional",
              description: <>Structured message parts (rich content, attachments, tool output).</>,
            },
            {
              name: "status",
              type: "string — optional, indexed",
              description: (
                <>
                  Delivery status: <InlineCode>pending</InlineCode>,{" "}
                  <InlineCode>sending</InlineCode>, <InlineCode>sent</InlineCode>,{" "}
                  <InlineCode>delivered</InlineCode>, <InlineCode>read</InlineCode>,{" "}
                  <InlineCode>failed</InlineCode>, or a provider-specific value.
                </>
              ),
            },
            {
              name: "externalId",
              type: "string — optional, indexed",
              description: <>Provider-side id (Twilio SID, email message-id, ...).</>,
            },
            {
              name: "participant",
              type: "string — optional, indexed",
              description: (
                <>Resolved identity of the counterpart (phone, email address, user id).</>
              ),
            },
            {
              name: "raw",
              type: "json — optional",
              description: <>The original provider payload, kept verbatim for audit and debugging.</>,
            },
            {
              name: "createdAt",
              type: "date — indexed",
              required: true,
              description: <>Creation timestamp; the timeline sort key.</>,
            },
            {
              name: "updatedAt",
              type: "date — optional",
              description: <>Last update timestamp (e.g. on status transitions).</>,
            },
          ]}
        />
      </Section>

      <Section title="Internal runtime entities">
        <p>
          The remaining four entities are <strong>internal runtime state</strong> for platform
          delivery (subscriptions, locks, caches, queues). They are owned by the channel domain so
          the whole channel stack persists on InstantDB — consumers never touch these entities
          directly.
        </p>
        <Code title="channel_state">{`channel_state: i.entity({
  key: i.string().unique().indexed(),
  value: i.json().optional(),
  expiresAt: i.date().optional().indexed(),
  updatedAt: i.date(),
}),`}</Code>
        <PropsTable
          rows={[
            {
              name: "key",
              type: "string — unique, indexed",
              required: true,
              description: <>State entry key.</>,
            },
            { name: "value", type: "json — optional", description: <>Arbitrary state payload.</> },
            {
              name: "expiresAt",
              type: "date — optional, indexed",
              description: <>TTL for cache-style entries.</>,
            },
            {
              name: "updatedAt",
              type: "date",
              required: true,
              description: <>Last write timestamp.</>,
            },
          ]}
        />
        <Code title="channel_locks">{`channel_locks: i.entity({
  threadId: i.string().unique().indexed(),
  token: i.string(),
  expiresAt: i.date().indexed(),
}),`}</Code>
        <PropsTable
          rows={[
            {
              name: "threadId",
              type: "string — unique, indexed",
              required: true,
              description: <>One lock per platform thread.</>,
            },
            {
              name: "token",
              type: "string",
              required: true,
              description: <>Lock ownership token.</>,
            },
            {
              name: "expiresAt",
              type: "date — indexed",
              required: true,
              description: <>Lock expiry — stale locks are reclaimed.</>,
            },
          ]}
        />
        <Code title="channel_subscriptions">{`channel_subscriptions: i.entity({
  threadId: i.string().unique().indexed(),
  createdAt: i.date(),
}),`}</Code>
        <PropsTable
          rows={[
            {
              name: "threadId",
              type: "string — unique, indexed",
              required: true,
              description: <>Subscribed platform thread.</>,
            },
            {
              name: "createdAt",
              type: "date",
              required: true,
              description: <>When the subscription was created.</>,
            },
          ]}
        />
        <Code title="channel_queues">{`channel_queues: i.entity({
  threadId: i.string().indexed(),
  seq: i.number().indexed(),
  entry: i.json(),
  createdAt: i.date(),
}),`}</Code>
        <PropsTable
          rows={[
            {
              name: "threadId",
              type: "string — indexed",
              required: true,
              description: <>Thread the queued entry belongs to.</>,
            },
            {
              name: "seq",
              type: "number — indexed",
              required: true,
              description: <>Ordering sequence within the thread.</>,
            },
            {
              name: "entry",
              type: "json",
              required: true,
              description: <>The queued payload.</>,
            },
            {
              name: "createdAt",
              type: "date",
              required: true,
              description: <>Enqueue timestamp.</>,
            },
          ]}
        />
        <Callout tone="warning">
          Treat <InlineCode>channel_state</InlineCode>, <InlineCode>channel_locks</InlineCode>,{" "}
          <InlineCode>channel_subscriptions</InlineCode> and{" "}
          <InlineCode>channel_queues</InlineCode> as private to the delivery runtime. Query and
          write <InlineCode>channel_messages</InlineCode> only.
        </Callout>
      </Section>

      <Section title="Links">
        <p>Two links attach canonical messages to the events domain.</p>
        <Code title="links">{`channel_messagesContext: {
  forward: { on: "channel_messages", has: "one", label: "context" },
  reverse: { on: "context_contexts", has: "many", label: "channelMessages" },
},
channel_messagesItem: {
  forward: { on: "channel_messages", has: "one", label: "item" },
  reverse: { on: "context_events", has: "many", label: "channelMessages" },
},`}</Code>
        <PropsTable
          rows={[
            {
              name: "channel_messagesContext",
              type: "channel_messages.context ⇄ context_contexts.channelMessages",
              description: (
                <>
                  Each message belongs to <strong>one</strong> context; a context has{" "}
                  <strong>many</strong> messages. This is the link the timeline queries traverse
                  with <InlineCode>where: &#123; &quot;context.id&quot;: contextId &#125;</InlineCode>.
                </>
              ),
            },
            {
              name: "channel_messagesItem",
              type: "channel_messages.item ⇄ context_events.channelMessages",
              description: (
                <>
                  Optionally anchors a message to <strong>one</strong> context item (the event that
                  produced or consumed it); an item has <strong>many</strong> messages. Anchored
                  messages render inside their event in the thread timeline.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section title="Composition">
        <p>
          <InlineCode>channelDomain</InlineCode> includes <InlineCode>contextDomain</InlineCode>; the
          agent domain in turn includes <InlineCode>channelDomain</InlineCode>. Pushing the agent
          domain therefore gives you the whole stack — events, channel, and agent entities — in one
          InstantDB app.
        </p>
        <Code title="instant.schema.ts">{`import { agentDomain } from "@ekairos/agent/schema";

export default agentDomain.toInstantSchema();`}</Code>
        <p>
          Only using channel without the agent layer? Push{" "}
          <InlineCode>channelDomain.toInstantSchema()</InlineCode> instead. Have your own app
          domain? Compose it:
        </p>
        <Code title="instant.schema.ts (composed)">{`import { domain } from "@ekairos/domain";
import { agentDomain } from "@ekairos/agent/schema";
import { i } from "@instantdb/core";

const appDomain = domain("app")
  .includes(agentDomain)
  .withSchema({
    entities: {
      orders: i.entity({
        number: i.string().unique().indexed(),
        total: i.number(),
      }),
    },
    links: {},
    rooms: {},
  });

export default appDomain.toInstantSchema();`}</Code>
        <Code title="terminal">{`npx instant-cli@latest push schema`}</Code>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/reference/channel-message",
              label: "Reference: ChannelMessage",
              description: "The TypeScript type that mirrors channel_messages.",
            },
            {
              href: "/channel/docs/reference/use-thread",
              label: "Reference: useThread",
              description: "How the links power the multichannel timeline.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

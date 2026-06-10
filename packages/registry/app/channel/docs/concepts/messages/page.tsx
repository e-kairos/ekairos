import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";

export const metadata = {
  title: "Channel — Messages | Ekairos Registry",
  description:
    "The canonical channel_messages model: fields, directions, context links, and where provider payloads live.",
};

export default function ChannelMessagesConceptPage() {
  return (
    <DocPage
      eyebrow="channel / concepts"
      title="Messages"
      lead={
        <>
          Every message that crosses any channel — a whatsapp text, an email reply, a slack mention —
          lands in one entity: <InlineCode>channel_messages</InlineCode>. One canonical shape,
          indexed and queryable, with the provider payload preserved verbatim alongside it.
        </>
      }
    >
      <Section title="One entity for every channel">
        <p>
          The channel domain refuses per-provider message tables. A Twilio webhook body and a Resend
          delivery event describe the same domain fact — <strong>a message crossed a channel</strong> —
          so they normalize into the same record. Provider-specific records (a Resend email row, a
          Twilio message row) stay in app or provider domains and link back via{" "}
          <InlineCode>externalId</InlineCode> and <InlineCode>raw</InlineCode>.
        </p>
        <Code title="@ekairos/channel — the canonical type">{`export type ChannelMessage = {
  id: string;
  channel: ChannelKind;           // "web" | "email" | "whatsapp" | (string & {})
  direction: ChannelDirection;    // "inbound" | "outbound"
  role?: "user" | "assistant" | "system";
  text?: string;
  parts?: unknown[];
  status?: ChannelMessageStatus;  // "pending" | "sending" | "sent" | "delivered" | "read" | "failed" | ...
  externalId?: string;
  participant?: string;
  raw?: unknown;
  createdAt: string;
  updatedAt?: string;
  // Links into the agent context, when attached.
  contextId?: string;
  itemId?: string;
};`}</Code>
        <p>
          The type mirrors the <InlineCode>channel_messages</InlineCode> entity one-to-one. What you
          read with an InstantDB query is what the runtime persisted — there is no translation layer
          between storage and your UI.
        </p>
      </Section>

      <Section title="Field reference">
        <PropsTable
          rows={[
            {
              name: "channel",
              type: "ChannelKind",
              required: true,
              description: (
                <>
                  Which channel the message crossed. Open union: <InlineCode>web</InlineCode>,{" "}
                  <InlineCode>email</InlineCode>, <InlineCode>whatsapp</InlineCode> get literal
                  types; any string is a valid custom kind. Indexed.
                </>
              ),
            },
            {
              name: "direction",
              type: '"inbound" | "outbound"',
              required: true,
              description: (
                <>
                  Inbound entered your system from the outside world; outbound left it. Indexed —
                  this is how a timeline decides which side a bubble renders on.
                </>
              ),
            },
            {
              name: "role",
              type: '"user" | "assistant" | "system"',
              description: (
                <>
                  Conversational role, when the message participates in an agent conversation.
                  Inbound is usually <InlineCode>user</InlineCode>; replies the agent posts are{" "}
                  <InlineCode>assistant</InlineCode>.
                </>
              ),
            },
            {
              name: "text",
              type: "string",
              description: "Plain-text body. The lowest common denominator every platform supports.",
            },
            {
              name: "parts",
              type: "unknown[]",
              description: (
                <>
                  Structured content (rich parts, attachments, tool output) for channels that carry
                  more than text. Stored as JSON.
                </>
              ),
            },
            {
              name: "status",
              type: "ChannelMessageStatus",
              description: (
                <>
                  Delivery lifecycle, mostly meaningful outbound:{" "}
                  <InlineCode>pending → sending → sent → delivered → read</InlineCode>, or{" "}
                  <InlineCode>failed</InlineCode>. Open union — providers with extra states fit.
                  Indexed.
                </>
              ),
            },
            {
              name: "externalId",
              type: "string",
              description: (
                <>
                  The provider&apos;s id for this message (a Meta <InlineCode>wamid</InlineCode>, a
                  Resend email id, a slack <InlineCode>ts</InlineCode>). Indexed — the join key for
                  delivery receipts and provider-side records.
                </>
              ),
            },
            {
              name: "participant",
              type: "string",
              description:
                "Resolved identity of the counterpart: a phone number, an email address, a platform user id. Indexed.",
            },
            {
              name: "raw",
              type: "unknown",
              description:
                "The provider payload, verbatim. Never normalized, never required for rendering.",
            },
            {
              name: "createdAt",
              type: "date",
              required: true,
              description: "When the message was persisted. Indexed — timelines order by it.",
            },
            {
              name: "updatedAt",
              type: "date",
              description: "Last mutation, typically a status transition from a delivery receipt.",
            },
            {
              name: "context",
              type: "link → event_contexts",
              description: (
                <>
                  <InlineCode>contextId</InlineCode> on the type. Attaches the message to the agent
                  context that owns the conversation. One context has many channel messages.
                </>
              ),
            },
            {
              name: "item",
              type: "link → event_items",
              description: (
                <>
                  <InlineCode>itemId</InlineCode> on the type. Optionally pairs the message with the
                  agent item it produced or mirrors (the trigger item for an inbound, the reaction
                  item for a reply).
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section title="Inbound and outbound">
        <p>
          The two directions have different lifecycles. An <strong>inbound</strong> message is born
          complete: the delivery runtime receives a webhook, persists the canonical record, and only
          then hands it to your <InlineCode>react</InlineCode> handler — by the time your code runs,
          the message is already on InstantDB and already visible in every subscribed timeline.
        </p>
        <p>
          An <strong>outbound</strong> message is born <InlineCode>pending</InlineCode> and earns
          its way through the status union: the adapter send yields an{" "}
          <InlineCode>externalId</InlineCode> and a first status, and later delivery receipts
          (matched by that <InlineCode>externalId</InlineCode>) advance it to{" "}
          <InlineCode>delivered</InlineCode> or <InlineCode>read</InlineCode>. Because the UI reads
          the entity reactively, every transition repaints without any polling.
        </p>
      </Section>

      <Section title="Links into the context">
        <p>
          Two links wire channel messages into the agent&apos;s world, both defined in the channel
          domain schema:
        </p>
        <Code title="@ekairos/channel/schema — links">{`channel_messagesContext: {
  forward: { on: "channel_messages", has: "one", label: "context" },
  reverse: { on: "event_contexts", has: "many", label: "channelMessages" },
},
channel_messagesItem: {
  forward: { on: "channel_messages", has: "one", label: "item" },
  reverse: { on: "event_items", has: "many", label: "channelMessages" },
},`}</Code>
        <p>
          The <InlineCode>context</InlineCode> link is the load-bearing one: it is what makes{" "}
          <InlineCode>&#123; channel_messages: &#123; $: &#123; where: &#123; &quot;context.id&quot;:
          contextId &#125; &#125; &#125; &#125;</InlineCode> return the whole multichannel
          conversation. The <InlineCode>item</InlineCode> link is finer-grained — it ties a specific
          message to the specific <InlineCode>event_items</InlineCode> row it corresponds to, so an
          agent reaction and the whatsapp text that delivered it can be navigated in both directions.
        </p>
      </Section>

      <Section title="Raw payloads vs the canonical model">
        <p>
          The split is deliberate and strict. The <strong>canonical fields</strong> carry everything
          the rest of the system is allowed to depend on: rendering, ordering, filtering, agent
          reactions, status logic. The <strong>raw payload</strong> carries everything else —
          provider metadata, signature material, fields you have not modeled yet — untouched, for
          audit and for the day you need one more field.
        </p>
        <Callout>
          Rule of thumb: if a component or a reactor reads it, it belongs in a canonical field. If
          only a debugging session or a future migration reads it, it belongs in{" "}
          <InlineCode>raw</InlineCode>. Never make UI code reach into <InlineCode>raw</InlineCode> —
          that is how provider coupling leaks back in.
        </Callout>
      </Section>

      <Section title="Anatomy of an inbound record">
        <p>
          The <InlineCode>createChannelMessage</InlineCode> helper fills in <InlineCode>id</InlineCode>{" "}
          and <InlineCode>createdAt</InlineCode> so call sites stay declarative:
        </p>
        <Code title="creating a canonical record">{`import { createChannelMessage, WHATSAPP_CHANNEL } from "@ekairos/channel";

const message = createChannelMessage({
  channel: WHATSAPP_CHANNEL,
  direction: "inbound",
  role: "user",
  text: payload.text.body,
  externalId: payload.id,
  participant: payload.from,
  raw: payload,
  contextId,
});

await store.saveChannelMessage(message);`}</Code>
        <p>This is what an inbound whatsapp message looks like at rest:</p>
        <Code title="channel_messages — a persisted whatsapp inbound">{`{
  "id": "8b1f6f0a-3d4c-4f2e-9a71-5c0d2e9b6f10",
  "channel": "whatsapp",
  "direction": "inbound",
  "role": "user",
  "text": "Do you have SKU 4411 in stock?",
  "externalId": "wamid.HBgNNTQ5MTE1NTU1MDEyMxUCABIYFjNFQjBEMUE4QkY3RkY1RDhEN0M2AA==",
  "participant": "+5491155550123",
  "raw": {
    "from": "5491155550123",
    "id": "wamid.HBgNNTQ5MTE1NTU1MDEyMxUCABIYFjNFQjBEMUE4QkY3RkY1RDhEN0M2AA==",
    "timestamp": "1781445801",
    "type": "text",
    "text": { "body": "Do you have SKU 4411 in stock?" }
  },
  "createdAt": "2026-06-10T14:03:21.000Z",
  "contextId": "c4a9e2d1-7b30-4e8f-b2c5-1f6d8a0e3b42"
}`}</Code>
        <p>
          Note what the record does <em>not</em> contain: no whatsapp-specific columns, no
          provider-shaped nesting outside <InlineCode>raw</InlineCode>. Swap whatsapp for telegram
          and only <InlineCode>channel</InlineCode>, <InlineCode>externalId</InlineCode> and{" "}
          <InlineCode>raw</InlineCode> change shape — everything downstream keeps working.
        </p>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/concepts/threads",
              label: "Threads & contexts",
              description: "How channel messages and agent items share one context per conversation.",
            },
            {
              href: "/channel/docs/reference/channel-message",
              label: "ChannelMessage reference",
              description: "Full type-level reference for the canonical message and its helpers.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";

export const metadata = {
  title: "Channel — ChannelMessage | Ekairos Registry",
  description:
    "API reference for ChannelMessage, ChannelKind, ChannelDirection, ChannelMessageStatus, createChannelMessage, and ChannelMessageStore.",
};

export default function ChannelMessageReferencePage() {
  return (
    <DocPage
      eyebrow="channel / reference"
      title="ChannelMessage"
      lead={
        <>
          The canonical message crossing any channel. It mirrors the{" "}
          <InlineCode>channel_messages</InlineCode> entity; provider payloads live in{" "}
          <InlineCode>raw</InlineCode> and provider ids in <InlineCode>externalId</InlineCode>.
          Every channel — web, email, whatsapp, slack, custom — flows through this one shape.
        </>
      }
    >
      <Section title="Type">
        <Code title="@ekairos/channel">{`export type ChannelMessage = {
  id: string;
  channel: ChannelKind;
  direction: ChannelDirection;
  role?: "user" | "assistant" | "system";
  text?: string;
  parts?: unknown[];
  status?: ChannelMessageStatus;
  externalId?: string;
  participant?: string;
  raw?: unknown;
  createdAt: string;
  updatedAt?: string;
  contextId?: string;
  itemId?: string;
};`}</Code>
        <PropsTable
          rows={[
            {
              name: "id",
              type: "string",
              required: true,
              description: <>Stable message id (UUID in InstantDB deployments).</>,
            },
            {
              name: "channel",
              type: "ChannelKind",
              required: true,
              description: (
                <>
                  Which channel the message belongs to: <InlineCode>&quot;web&quot;</InlineCode>,{" "}
                  <InlineCode>&quot;email&quot;</InlineCode>,{" "}
                  <InlineCode>&quot;whatsapp&quot;</InlineCode>, or any custom kind.
                </>
              ),
            },
            {
              name: "direction",
              type: "ChannelDirection",
              required: true,
              description: (
                <>
                  <InlineCode>&quot;inbound&quot;</InlineCode> (from the counterpart to your system)
                  or <InlineCode>&quot;outbound&quot;</InlineCode> (from your system out).
                </>
              ),
            },
            {
              name: "role",
              type: '"user" | "assistant" | "system"',
              description: <>Conversational role, when the message participates in an agent thread.</>,
            },
            {
              name: "text",
              type: "string",
              description: <>Plain-text body.</>,
            },
            {
              name: "parts",
              type: "unknown[]",
              description: <>Structured parts (rich content, attachments, tool results).</>,
            },
            {
              name: "status",
              type: "ChannelMessageStatus",
              description: <>Delivery lifecycle status; see the union below.</>,
            },
            {
              name: "externalId",
              type: "string",
              description: <>Provider-side id (Twilio SID, email message-id, platform timestamp).</>,
            },
            {
              name: "participant",
              type: "string",
              description: (
                <>Resolved identity of the counterpart (phone, email address, user id).</>
              ),
            },
            {
              name: "raw",
              type: "unknown",
              description: <>Original provider payload, kept verbatim.</>,
            },
            {
              name: "createdAt",
              type: "string",
              required: true,
              description: <>ISO timestamp; the timeline sort key.</>,
            },
            {
              name: "updatedAt",
              type: "string",
              description: <>ISO timestamp of the last update (e.g. a status transition).</>,
            },
            {
              name: "contextId",
              type: "string",
              description: (
                <>
                  Links into the agent context, when attached — mirrors the{" "}
                  <InlineCode>channel_messagesContext</InlineCode> link.
                </>
              ),
            },
            {
              name: "itemId",
              type: "string",
              description: (
                <>
                  Anchors the message to one context item, when attached — mirrors the{" "}
                  <InlineCode>channel_messagesItem</InlineCode> link. Anchored messages render
                  inside their event in the thread timeline.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section title="ChannelKind">
        <Code title="open union + constants">{`export const WEB_CHANNEL = "web";
export const EMAIL_CHANNEL = "email";
export const WHATSAPP_CHANNEL = "whatsapp";

/** Open union: known channels get literal types, custom channels are allowed. */
export type ChannelKind = "web" | "email" | "whatsapp" | (string & {});`}</Code>
        <p>
          The <InlineCode>(string &amp; &#123;&#125;)</InlineCode> trick keeps the union open: the
          three known kinds autocomplete, and any other string (a custom{" "}
          <InlineCode>&quot;sms&quot;</InlineCode> or <InlineCode>&quot;push&quot;</InlineCode>{" "}
          channel) still typechecks. Prefer the exported constants over string literals when
          referring to the built-in kinds.
        </p>
      </Section>

      <Section title="ChannelDirection">
        <Code title="type">{`export type ChannelDirection = "inbound" | "outbound";`}</Code>
        <PropsTable
          rows={[
            {
              name: '"inbound"',
              type: "ChannelDirection",
              description: <>Received from the counterpart (a webhook delivery, an incoming email).</>,
            },
            {
              name: '"outbound"',
              type: "ChannelDirection",
              description: <>Sent by your system (an agent reply, a broadcast).</>,
            },
          ]}
        />
      </Section>

      <Section title="ChannelMessageStatus">
        <Code title="open union">{`export type ChannelMessageStatus =
  | "pending"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | (string & {});`}</Code>
        <PropsTable
          rows={[
            { name: '"pending"', type: "status", description: <>Created, not yet handed to a provider.</> },
            { name: '"sending"', type: "status", description: <>In flight to the provider.</> },
            { name: '"sent"', type: "status", description: <>Accepted by the provider.</> },
            { name: '"delivered"', type: "status", description: <>Confirmed delivered to the counterpart.</> },
            { name: '"read"', type: "status", description: <>Read receipt received.</> },
            { name: '"failed"', type: "status", description: <>Delivery failed; details usually in <InlineCode>raw</InlineCode>.</> },
            {
              name: "(string & {})",
              type: "status",
              description: <>Open for provider-specific statuses that do not map to the six above.</>,
            },
          ]}
        />
      </Section>

      <Section title="createChannelMessage">
        <Code title="signature">{`export function createChannelMessage(
  input: Omit<ChannelMessage, "id" | "createdAt"> & { id?: string; createdAt?: string },
): ChannelMessage`}</Code>
        <p>
          Builds a complete <InlineCode>ChannelMessage</InlineCode> from a partial input, filling in
          the two defaults:
        </p>
        <PropsTable
          rows={[
            {
              name: "id",
              type: "string",
              description: (
                <>
                  Defaults to <InlineCode>crypto.randomUUID()</InlineCode> (with a timestamp-random
                  fallback when the Web Crypto API is unavailable).
                </>
              ),
            },
            {
              name: "createdAt",
              type: "string",
              description: (
                <>
                  Defaults to <InlineCode>new Date().toISOString()</InlineCode>.
                </>
              ),
            },
          ]}
        />
        <Code title="usage">{`import { createChannelMessage, WHATSAPP_CHANNEL } from "@ekairos/channel";

const message = createChannelMessage({
  channel: WHATSAPP_CHANNEL,
  direction: "inbound",
  role: "user",
  text: "Hola, ¿tienen stock del modelo XR-200?",
  participant: "+5491155550123",
  externalId: "SMa4c9f2e8d7b64f1aa0c3",
  contextId: "ctx_01HZX4Q8",
});
// → { id: "9f4b...", createdAt: "2026-06-10T14:03:21.000Z", ...input }`}</Code>
      </Section>

      <Section title="ChannelMessageStore">
        <Code title="interface">{`export interface ChannelMessageStore {
  saveChannelMessage(message: ChannelMessage): Promise<ChannelMessage>;
  getChannelMessages(params: { contextId: string }): Promise<ChannelMessage[]>;
}`}</Code>
        <PropsTable
          rows={[
            {
              name: "saveChannelMessage",
              type: "(message: ChannelMessage) => Promise<ChannelMessage>",
              required: true,
              description: (
                <>
                  Persists one canonical message (and its context/item links, when{" "}
                  <InlineCode>contextId</InlineCode>/<InlineCode>itemId</InlineCode> are set).
                  Returns the persisted record.
                </>
              ),
            },
            {
              name: "getChannelMessages",
              type: "(params: { contextId: string }) => Promise<ChannelMessage[]>",
              required: true,
              description: <>Reads every message attached to a context.</>,
            },
          ]}
        />
        <p>Who implements it:</p>
        <PropsTable
          rows={[
            {
              name: "Instant-backed store",
              type: "internal to the runtime",
              description: (
                <>
                  InstantDB deployments back the interface with the{" "}
                  <InlineCode>channel_messages</InlineCode> entity. You get it as{" "}
                  <InlineCode>channels.store</InlineCode> from <InlineCode>createChannels</InlineCode>{" "}
                  — you never construct it yourself.
                </>
              ),
            },
            {
              name: "MemoryAgentStore",
              type: "@ekairos/agent",
              description: (
                <>
                  In-memory implementation for local/embedded runtimes (Electron, CLIs, tests). It
                  implements <InlineCode>ChannelMessageStore</InlineCode> alongside the context and
                  thread stores, so the same agent code runs without InstantDB.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section title="Real-world records">
        <Code title="inbound whatsapp message">{`{
  id: "6c1f6a3e-2d44-4d8a-9f0b-7a3c5e91d2b8",
  channel: "whatsapp",
  direction: "inbound",
  role: "user",
  text: "Hola, ¿tienen stock del modelo XR-200?",
  status: "delivered",
  externalId: "SMa4c9f2e8d7b64f1aa0c3",
  participant: "+5491155550123",
  raw: { MessageSid: "SMa4c9f2e8d7b64f1aa0c3", From: "whatsapp:+5491155550123", Body: "..." },
  createdAt: "2026-06-10T14:03:21.000Z",
  contextId: "ctx_01HZX4Q8"
}`}</Code>
        <Code title="outbound email message">{`{
  id: "b8e2c7d1-90af-4a36-8c52-f41d0e6a9b77",
  channel: "email",
  direction: "outbound",
  role: "assistant",
  text: "Yes — the XR-200 is in stock. I attached the quote you asked for.",
  status: "sent",
  externalId: "re_8GqkPzVx3JmN2cTd",
  participant: "purchasing@acme-industries.com",
  raw: { id: "re_8GqkPzVx3JmN2cTd", to: ["purchasing@acme-industries.com"] },
  createdAt: "2026-06-10T14:05:02.000Z",
  updatedAt: "2026-06-10T14:05:04.000Z",
  contextId: "ctx_01HZX4Q8",
  itemId: "itm_01HZX4RM"
}`}</Code>
        <Callout>
          Note <InlineCode>itemId</InlineCode> on the outbound record: the reply is anchored to the
          agent item that produced it, so the timeline renders it inside that event instead of as a
          standalone entry.
        </Callout>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/reference/adapters",
              label: "Reference: Adapters & registry",
              description: "ChannelAdapter, ChannelOutboundMessage, ChannelSendResult.",
            },
            {
              href: "/channel/docs/reference/schema",
              label: "Reference: Schema",
              description: "The channel_messages entity and its links.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

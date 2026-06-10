import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";

export const metadata = {
  title: "Channel — Adapters & registry | Ekairos Registry",
  description:
    "API reference for ChannelAdapter, ChannelOutboundMessage, ChannelSendResult, and ChannelRegistry.",
};

export default function AdaptersReferencePage() {
  return (
    <DocPage
      eyebrow="channel / reference"
      title="Adapters &amp; registry"
      lead={
        <>
          <InlineCode>ChannelAdapter</InlineCode> is the provider plugin contract for{" "}
          <strong>custom</strong> channels: implementations (Resend email, Twilio whatsapp, push,
          ...) live in apps or provider packages and register by kind on a{" "}
          <InlineCode>ChannelRegistry</InlineCode>. The built-in platforms do not need adapters —
          the delivery runtime handles them end to end.
        </>
      }
    >
      <Section title="ChannelAdapter">
        <Code title="@ekairos/channel">{`export interface ChannelAdapter {
  readonly kind: ChannelKind;
  send(message: ChannelOutboundMessage): Promise<ChannelSendResult>;
}`}</Code>
        <PropsTable
          rows={[
            {
              name: "kind",
              type: "ChannelKind (readonly)",
              required: true,
              description: (
                <>
                  The channel this adapter delivers for. One adapter per kind — registering a second
                  adapter with the same kind replaces the first.
                </>
              ),
            },
            {
              name: "send",
              type: "(message: ChannelOutboundMessage) => Promise<ChannelSendResult>",
              required: true,
              description: (
                <>
                  Delivers one outbound message through the provider and reports the result. Throw
                  on hard failures; return <InlineCode>status: &quot;failed&quot;</InlineCode> for
                  provider-reported failures you want recorded.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section title="ChannelOutboundMessage">
        <Code title="type">{`export type ChannelOutboundMessage = Omit<ChannelMessage, "id" | "createdAt" | "direction"> & {
  direction?: "outbound";
};`}</Code>
        <p>
          Everything a <InlineCode>ChannelMessage</InlineCode> has, minus the fields the send path
          owns:
        </p>
        <PropsTable
          rows={[
            {
              name: "id, createdAt",
              type: "omitted",
              description: (
                <>
                  Assigned at persistence time (e.g. by{" "}
                  <InlineCode>createChannelMessage</InlineCode>), not by the caller of{" "}
                  <InlineCode>send</InlineCode>.
                </>
              ),
            },
            {
              name: "direction",
              type: '"outbound" — optional',
              description: (
                <>
                  Narrowed to <InlineCode>&quot;outbound&quot;</InlineCode> and optional: an
                  outbound message cannot be anything else, so you may omit it.
                </>
              ),
            },
            {
              name: "channel, text, parts, participant, ...",
              type: "inherited from ChannelMessage",
              description: (
                <>
                  All remaining fields carry over unchanged. <InlineCode>channel</InlineCode> picks
                  the adapter; <InlineCode>participant</InlineCode> is the recipient (phone, email
                  address, user id).
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section title="ChannelSendResult">
        <Code title="type">{`export type ChannelSendResult = {
  externalId?: string;
  status: ChannelMessageStatus;
  raw?: unknown;
};`}</Code>
        <PropsTable
          rows={[
            {
              name: "externalId",
              type: "string",
              description: (
                <>
                  The provider&apos;s id for the sent message (Twilio SID, Resend id). Persist it on
                  the message so later status webhooks can be correlated.
                </>
              ),
            },
            {
              name: "status",
              type: "ChannelMessageStatus",
              required: true,
              description: (
                <>
                  Status reported by the provider — typically{" "}
                  <InlineCode>&quot;sent&quot;</InlineCode> on success or{" "}
                  <InlineCode>&quot;failed&quot;</InlineCode> on a provider-side rejection.
                </>
              ),
            },
            {
              name: "raw",
              type: "unknown",
              description: <>The provider&apos;s raw response, kept for audit and debugging.</>,
            },
          ]}
        />
      </Section>

      <Section title="ChannelRegistry">
        <Code title="class">{`export class ChannelRegistry {
  register(adapter: ChannelAdapter): this;
  get(kind: ChannelKind): ChannelAdapter | null;
  kinds(): ChannelKind[];
  send(message: ChannelOutboundMessage): Promise<ChannelSendResult>;
}`}</Code>
        <PropsTable
          rows={[
            {
              name: "register",
              type: "(adapter: ChannelAdapter) => this",
              description: (
                <>
                  Registers an adapter under its <InlineCode>kind</InlineCode>. Returns{" "}
                  <InlineCode>this</InlineCode>, so calls chain.
                </>
              ),
            },
            {
              name: "get",
              type: "(kind: ChannelKind) => ChannelAdapter | null",
              description: (
                <>
                  Looks an adapter up by kind; <InlineCode>null</InlineCode> when none is
                  registered.
                </>
              ),
            },
            {
              name: "kinds",
              type: "() => ChannelKind[]",
              description: <>Every kind with a registered adapter.</>,
            },
            {
              name: "send",
              type: "(message: ChannelOutboundMessage) => Promise<ChannelSendResult>",
              description: (
                <>
                  Routes the message to the adapter matching{" "}
                  <InlineCode>message.channel</InlineCode> and delegates to its{" "}
                  <InlineCode>send</InlineCode>.
                </>
              ),
            },
          ]}
        />
        <Callout tone="warning">
          <InlineCode>registry.send</InlineCode> throws{" "}
          <InlineCode>
            Error(&quot;channel_adapter_not_registered:&lt;kind&gt;&quot;)
          </InlineCode>{" "}
          when no adapter is registered for <InlineCode>message.channel</InlineCode>. Register every
          kind you send on at boot, before the first send.
        </Callout>
      </Section>

      <Section title="When to write an adapter — and when not to">
        <PropsTable
          rows={[
            {
              name: "Write an adapter",
              type: "custom channels",
              description: (
                <>
                  Channels you deliver yourself: your own transactional email (Resend, SES), SMS or
                  whatsapp through Twilio, mobile push, an in-house gateway. The adapter is the only
                  provider-specific code; everything else (persistence, timeline, agent reaction)
                  stays canonical.
                </>
              ),
            },
            {
              name: "Do not write an adapter",
              type: "built-in platforms",
              description: (
                <>
                  Slack, Teams, Google Chat, Discord and Telegram are delivered by the runtime
                  itself: configure them in <InlineCode>createChannels</InlineCode>{" "}
                  <InlineCode>platforms</InlineCode> and reply via <InlineCode>react</InlineCode> /{" "}
                  <InlineCode>inbound.reply</InlineCode>. No registry involved.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section title="Complete example: an email adapter">
        <Code title="lib/channels/email-adapter.ts">{`import { Resend } from "resend";
import {
  EMAIL_CHANNEL,
  type ChannelAdapter,
  type ChannelOutboundMessage,
  type ChannelSendResult,
} from "@ekairos/channel";

const resend = new Resend(process.env.RESEND_API_KEY!);

export const emailAdapter: ChannelAdapter = {
  kind: EMAIL_CHANNEL,

  async send(message: ChannelOutboundMessage): Promise<ChannelSendResult> {
    if (!message.participant) {
      throw new Error("email_adapter: message.participant (recipient) is required");
    }
    const { data, error } = await resend.emails.send({
      from: "Ekairos <agent@updates.ekairos.dev>",
      to: [message.participant],
      subject: "Re: your conversation",
      text: message.text ?? "",
    });
    if (error) {
      return { status: "failed", raw: error };
    }
    return { externalId: data?.id, status: "sent", raw: data };
  },
};`}</Code>
        <Code title="lib/channels/registry.ts">{`import { ChannelRegistry, createChannelMessage, EMAIL_CHANNEL } from "@ekairos/channel";
import { emailAdapter } from "./email-adapter";
import { channels } from "@/lib/channels"; // ChannelsRuntime from createChannels

export const registry = new ChannelRegistry().register(emailAdapter);

/** Send an email from the product and persist the canonical record. */
export async function sendEmail(params: { to: string; text: string; contextId: string }) {
  const outbound = {
    channel: EMAIL_CHANNEL,
    role: "assistant" as const,
    text: params.text,
    participant: params.to,
    contextId: params.contextId,
  };
  const result = await registry.send(outbound);
  return await channels.store.saveChannelMessage(
    createChannelMessage({
      ...outbound,
      direction: "outbound",
      status: result.status,
      externalId: result.externalId,
      raw: result.raw,
    }),
  );
}`}</Code>
        <p>
          The pattern is always the same: <InlineCode>registry.send</InlineCode> delivers,{" "}
          <InlineCode>createChannelMessage</InlineCode> fills <InlineCode>id</InlineCode>/
          <InlineCode>createdAt</InlineCode>, and <InlineCode>store.saveChannelMessage</InlineCode>{" "}
          persists the record — which makes it appear reactively in every timeline bound to that
          context.
        </p>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/reference/channel-message",
              label: "Reference: ChannelMessage",
              description: "The canonical type adapters send and stores persist.",
            },
            {
              href: "/channel/docs/reference/create-channels",
              label: "Reference: createChannels",
              description: "The built-in platforms that need no adapter.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";

export const metadata = {
  title: "Channel — createChannels | Ekairos Registry",
  description:
    "API reference for createChannels: options, the inbound contract, and the runtime it returns.",
};

export default function CreateChannelsReferencePage() {
  return (
    <DocPage
      eyebrow="channel / reference"
      title="createChannels"
      lead={
        <>
          Boots the multichannel runtime: every configured platform feeds the same inbound pipeline
          (canonical <InlineCode>channel_messages</InlineCode> on InstantDB → agent reaction → reply
          through the platform), and exposes one webhook handler per platform. Delivery internals
          are an implementation detail of the package.
        </>
      }
    >
      <Section title="Signature">
        <Code title="@ekairos/channel">{`export async function createChannels(
  options: CreateChannelsOptions,
): Promise<ChannelsRuntime>`}</Code>
        <p>
          Call it once at boot (a module-level <InlineCode>await</InlineCode> in a server file is
          fine). It lazily loads the platform runtime, connects every configured platform to the
          same store and reaction pipeline, and returns a <InlineCode>ChannelsRuntime</InlineCode>{" "}
          with one webhook handler per platform.
        </p>
      </Section>

      <Section title="CreateChannelsOptions">
        <PropsTable
          rows={[
            {
              name: "runtime",
              type: "ChannelsRuntimeHandle",
              required: true,
              description: (
                <>
                  App runtime that resolves active domain persistence and tenancy. Channel stores
                  canonical messages and delivery state (
                  <InlineCode>channel_state</InlineCode>, <InlineCode>channel_locks</InlineCode>,
                  ...) through this client.
                </>
              ),
            },
            {
              name: "userName",
              type: "string",
              required: true,
              description: <>Bot identity across platforms — the name the agent posts under.</>,
            },
            {
              name: "platforms",
              type: "ChannelPlatformsConfig",
              required: true,
              description: (
                <>
                  One entry per channel to enable. The shape of each entry is that platform&apos;s
                  credentials/config (bot tokens, signing secrets); it is passed through to the
                  underlying delivery runtime.
                </>
              ),
            },
            {
              name: "resolveContextId",
              type: "(params: { channel: ChannelKind; threadKey: string }) => Promise<string>",
              required: true,
              description: (
                <>
                  Maps a platform conversation to an agent context. Called with the channel kind and
                  the stable per-platform <InlineCode>threadKey</InlineCode>; return the{" "}
                  <InlineCode>contextId</InlineCode> the conversation belongs to (typically by
                  creating a context keyed on{" "}
                  <InlineCode>{"`${channel}:${threadKey}`"}</InlineCode>).
                </>
              ),
            },
            {
              name: "react",
              type: "(inbound: ChannelInbound) => Promise<string | null | undefined | void>",
              required: true,
              description: (
                <>
                  Reacts to an inbound message. Use <InlineCode>bindReaction</InlineCode> to map the
                  inbound message to a domain event and execute a reaction definition. Return text
                  to auto-reply, or use{" "}
                  <InlineCode>inbound.reply</InlineCode> for streaming / multi-part replies and
                  return <InlineCode>null</InlineCode>.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section title="ChannelPlatformsConfig">
        <Code title="type">{`export type ChannelPlatformsConfig = Partial<
  Record<"slack" | "teams" | "gchat" | "discord" | "telegram", Record<string, unknown>>
> &
  Record<string, Record<string, unknown> | undefined>;`}</Code>
        <p>
          The five known platform keys get autocompletion; the index signature keeps the map open
          for additional platforms. Each value is an opaque{" "}
          <InlineCode>Record&lt;string, unknown&gt;</InlineCode> of platform credentials, forwarded
          verbatim to the delivery runtime.
        </p>
      </Section>

      <Section title="ChannelInbound">
        <p>
          The object handed to your <InlineCode>react</InlineCode> callback for every inbound
          message.
        </p>
        <PropsTable
          rows={[
            {
              name: "channel",
              type: "ChannelKind",
              required: true,
              description: (
                <>
                  Which channel the message arrived on (<InlineCode>&quot;slack&quot;</InlineCode>,{" "}
                  <InlineCode>&quot;telegram&quot;</InlineCode>, ...). Open union — custom kinds are
                  allowed.
                </>
              ),
            },
            {
              name: "threadKey",
              type: "string",
              required: true,
              description: (
                <>
                  Stable per-platform conversation key. Use it to key agent threads so the same
                  platform conversation always maps to the same thread.
                </>
              ),
            },
            {
              name: "contextId",
              type: "string",
              required: true,
              description: (
                <>
                  The agent context this conversation maps to — the value your{" "}
                  <InlineCode>resolveContextId</InlineCode> returned.
                </>
              ),
            },
            {
              name: "message",
              type: "ChannelMessage",
              required: true,
              description: (
                <>
                  The persisted canonical inbound message. Already written to{" "}
                  <InlineCode>channel_messages</InlineCode> and linked to the context before{" "}
                  <InlineCode>react</InlineCode> runs.
                </>
              ),
            },
            {
              name: "reply",
              type: "(text: string) => Promise<void>",
              required: true,
              description: (
                <>
                  Posts a reply on the same platform thread and persists it as an outbound{" "}
                  <InlineCode>channel_messages</InlineCode> record. Call it any number of times for
                  multi-part replies.
                </>
              ),
            },
            {
              name: "attachItem",
              type: "(itemId: string) => Promise<void>",
              required: true,
              description: (
                <>
                  Links the canonical channel message to the trigger event emitted by{" "}
                  <InlineCode>bindReaction</InlineCode>.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section title="ChannelsRuntime">
        <PropsTable
          rows={[
            {
              name: "platforms",
              type: "string[]",
              required: true,
              description: <>Platforms that were enabled, in the order they were configured.</>,
            },
            {
              name: "webhooks",
              type: "Record<string, (request: Request, options?: Record<string, unknown>) => Promise<Response>>",
              required: true,
              description: (
                <>
                  Webhook handlers to mount per platform — one fetch-style handler keyed by platform
                  name (e.g. mount under{" "}
                  <InlineCode>app/api/channels/[platform]</InlineCode>).
                </>
              ),
            },
            {
              name: "store",
              type: "ChannelMessageStore",
              required: true,
              description: (
                <>
                  Canonical message store, for app-side writes (broadcasts, outbound messages you
                  trigger yourself, etc).
                </>
              ),
            },
            {
              name: "dispose",
              type: "() => Promise<void>",
              required: true,
              description: (
                <>Tears the runtime down — disconnects platforms and releases internal resources.</>
              ),
            },
          ]}
        />
      </Section>

      <Section title="bindReaction">
        <Code title="signature">{`export type BindReactionOptions<
  Definition extends ReactionDefinition<any, any, any, any>,
> = Readonly<{
  runtime: ChannelAgentRuntime;
  reaction: Definition;
  event: (inbound: ChannelInbound) =>
    | ReturnType<Definition["trigger"]>
    | Promise<ReturnType<Definition["trigger"]>>;
  replyText?: (
    effect: ReactionEffectOf<Definition>,
    inbound: ChannelInbound,
  ) => string | null | Promise<string | null>;
}>;

export function bindReaction<
  Definition extends ReactionDefinition<any, any, any, any>,
>(options: BindReactionOptions<Definition>):
  (inbound: ChannelInbound) => Promise<string | null>`}</Code>
        <p>
          The binding emits the mapped domain event, attaches it to the canonical message, loads the
          resolved context, and executes{" "}
          <InlineCode>context.react(event, definition)</InlineCode>. When{" "}
          <InlineCode>replyText</InlineCode> is omitted, it scans effects from last to first and
          returns a non-empty string payload or its <InlineCode>text</InlineCode> or{" "}
          <InlineCode>reply</InlineCode> field.
        </p>
      </Section>

      <Section title="Complete example">
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
      </Section>

      <Section title="Reply semantics">
        <p>
          The return value of <InlineCode>react</InlineCode> drives the auto-reply:
        </p>
        <PropsTable
          rows={[
            {
              name: "string",
              type: "return value",
              description: (
                <>
                  Auto-reply: the runtime posts the text back on the same platform thread and
                  persists it as an outbound message. One return, one reply.
                </>
              ),
            },
            {
              name: "null | undefined | void",
              type: "return value",
              description: (
                <>
                  No auto-reply. Use this together with <InlineCode>inbound.reply</InlineCode> when
                  you want streaming or multi-part replies — call{" "}
                  <InlineCode>reply(text)</InlineCode> once per part as your reaction progresses,
                  then return <InlineCode>null</InlineCode>.
                </>
              ),
            },
          ]}
        />
        <Code title="multi-part reply">{`react: async (inbound) => {
  await inbound.reply("On it — checking the order...");
  const result = await lookupOrder(inbound.message.text ?? "");
  await inbound.reply(\`Order \${result.id} ships \${result.eta}.\`);
  return null; // replies already posted; no auto-reply
},`}</Code>
        <Callout>
          Every <InlineCode>reply</InlineCode> call persists its own outbound{" "}
          <InlineCode>channel_messages</InlineCode> record, so multi-part replies show up as
          individual messages in the timeline.
        </Callout>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/reference/schema",
              label: "Reference: Schema",
              description: "Entities and links the runtime persists to.",
            },
            {
              href: "/channel/docs/reference/channel-message",
              label: "Reference: ChannelMessage",
              description: "The canonical message type, field by field.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

import { Callout, Code, DocPage, InlineCode, NextLinks, Section } from "../../_kit";

export const metadata = {
  title: "Channel — Platforms | Ekairos Registry",
  description:
    "What a platform is, how createChannels configures one, and why delivery stays an implementation detail of the package.",
};

export default function ChannelPlatformsConceptPage() {
  return (
    <DocPage
      eyebrow="channel / concepts"
      title="Platforms"
      lead={
        <>
          A platform is a place where conversations happen — slack, teams, telegram, discord, google
          chat, or anything you name yourself. The channel domain gives every one of them the same
          contract: a config entry, a webhook, and one unified inbound pipeline that ends in{" "}
          <InlineCode>channel_messages</InlineCode>.
        </>
      }
    >
      <Section title="What a platform is">
        <p>
          In the channel domain a platform is just a <InlineCode>ChannelKind</InlineCode> with a
          delivery mechanism behind it. The kind is an <strong>open union</strong>: the package
          ships literal types for the channels it knows about, and any other string is equally
          valid — your editor keeps autocomplete for the known ones without closing the door on
          custom kinds.
        </p>
        <Code title="@ekairos/channel — ChannelKind">{`export const WEB_CHANNEL = "web";
export const EMAIL_CHANNEL = "email";
export const WHATSAPP_CHANNEL = "whatsapp";

/** Open union: known channels get literal types, custom channels are allowed. */
export type ChannelKind = "web" | "email" | "whatsapp" | (string & {});`}</Code>
        <p>
          The same openness applies to the platform config: <InlineCode>slack</InlineCode>,{" "}
          <InlineCode>teams</InlineCode>, <InlineCode>gchat</InlineCode>,{" "}
          <InlineCode>discord</InlineCode> and <InlineCode>telegram</InlineCode> are typed keys, and
          any additional string key is accepted. A kind you invent — <InlineCode>sms</InlineCode>,{" "}
          <InlineCode>kiosk</InlineCode>, an internal tool — flows through the same schema, the same
          links, the same UI components.
        </p>
      </Section>

      <Section title="Configuring platforms">
        <p>
          <InlineCode>createChannels</InlineCode> takes one entry per platform you want live. The
          shape of each entry is that platform&apos;s credentials and settings — bot tokens, signing
          secrets, app ids — and it is <strong>passed through</strong> to the underlying delivery
          runtime untouched. The channel package does not re-model every platform&apos;s auth; it
          forwards your config to the code that actually speaks the protocol.
        </p>
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
    discord: { botToken: process.env.DISCORD_BOT_TOKEN! },
  },
  resolveContextId: async ({ channel, threadKey }) => {
    const thread = await ensureThread({ key: \`\${channel}:\${threadKey}\` });
    return thread.contextId;
  },
  react: async (inbound) => {
    const reaction = await reactOnThread(inbound.contextId, inbound.message);
    return reaction.text;
  },
});`}</Code>
        <p>
          A platform you do not configure simply does not exist at runtime: no webhook handler is
          exposed for it, no state is kept for it. Adding a platform later is adding one key to{" "}
          <InlineCode>platforms</InlineCode> and pointing its webhook at your route.
        </p>
      </Section>

      <Section title="Adapters are optional peers">
        <p>
          Each platform&apos;s wire-level adapter lives in its own{" "}
          <InlineCode>@chat-adapter/*</InlineCode> package, declared as an{" "}
          <strong>optional peer dependency</strong>. You install exactly the platforms you run:
        </p>
        <Code title="terminal">{`pnpm add @chat-adapter/slack @chat-adapter/telegram
# discord, teams, gchat: only if you enable them`}</Code>
        <p>
          This keeps your dependency tree honest — a deployment that only does telegram never
          downloads slack&apos;s SDK — and it keeps versioning per-platform: a breaking change in
          one platform&apos;s API surfaces as one adapter bump, not a channel-package release. If
          you configure a platform whose adapter is missing, the runtime fails at boot with a clear
          error rather than at the first webhook.
        </p>
      </Section>

      <Section title="One inbound pipeline">
        <p>
          Every platform feeds the same four-stage pipeline. This is the central design decision of
          the domain — platforms differ at the edges, never in the middle:
        </p>
        <Code title="the unified inbound pipeline">{`webhook                 canonical record            react                  reply
  |                          |                         |                      |
POST /api/channels/slack -> channel_messages row    -> your react(inbound) -> posted on the same
(verified, parsed by        persisted on InstantDB     handler runs against    platform thread and
 the delivery runtime)      (direction: "inbound")     the agent context       persisted outbound`}</Code>
        <p>
          Stage two happens <em>before</em> your code runs: by the time{" "}
          <InlineCode>react</InlineCode> is invoked, the inbound message is already a persisted{" "}
          <InlineCode>channel_messages</InlineCode> row linked to its context, and every reactive
          timeline already shows it. Your handler receives a <InlineCode>ChannelInbound</InlineCode>{" "}
          — the canonical message, the resolved <InlineCode>contextId</InlineCode>, and a{" "}
          <InlineCode>reply</InlineCode> function. Return text for an auto-reply, or call{" "}
          <InlineCode>inbound.reply</InlineCode> yourself for multi-part responses and return{" "}
          <InlineCode>null</InlineCode>. Either way the reply is posted on the originating platform
          thread <em>and</em> persisted as an outbound record.
        </p>
      </Section>

      <Section title="threadKey: one conversation, one key">
        <p>
          Every inbound carries a <InlineCode>threadKey</InlineCode>: a stable identifier for the
          platform-side conversation — a slack thread, a telegram chat, a discord channel thread.
          The delivery runtime guarantees the <em>same</em> conversation always yields the{" "}
          <em>same</em> key, across messages, restarts and deploys.
        </p>
        <p>
          That stability is what makes <InlineCode>resolveContextId</InlineCode> a pure mapping:
          given <InlineCode>&#123; channel, threadKey &#125;</InlineCode>, return the agent context
          this conversation belongs to. The idiomatic implementation keys an agent thread as{" "}
          <InlineCode>{"`${channel}:${threadKey}`"}</InlineCode> and returns its context id —
          getting you one durable, multichannel context per platform conversation with no lookup
          tables of your own.
        </p>
      </Section>

      <Section title="Containment: delivery stays inside">
        <p>
          Notice what your code never touched in any snippet above: websocket connections, webhook
          signature verification, platform SDK clients, retry logic, event deduplication. All of
          that is the delivery runtime — an implementation detail behind{" "}
          <InlineCode>createChannels</InlineCode>, loaded lazily and owned entirely by the package.
        </p>
        <Callout>
          The contract is deliberately small: your application knows <strong>platforms</strong>{" "}
          (config keys), <strong>canonical messages</strong> (the entity), and{" "}
          <strong>two functions</strong> (<InlineCode>resolveContextId</InlineCode>,{" "}
          <InlineCode>react</InlineCode>). If the delivery internals are ever replaced, none of your
          code changes — the schema, the webhooks and the two callbacks are the whole surface.
        </Callout>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/guides/platform-setup",
              label: "Platform setup",
              description: "Per-platform credentials, webhook URLs and adapter installation.",
            },
            {
              href: "/channel/docs/concepts/state",
              label: "Runtime state",
              description: "The internal entities that keep delivery ordered, locked and durable.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

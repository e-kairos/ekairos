import { Callout, Code, DocPage, InlineCode, NextLinks, Section } from "../../_kit";

export const metadata = {
  title: "Channel — Platform setup | Ekairos Registry",
  description: "Adapter packages, credentials and config passthrough for each platform.",
};

export default function ChannelPlatformSetupGuidePage() {
  return (
    <DocPage
      eyebrow="channel / guides / platform-setup"
      title="Platform setup."
      lead={
        <>
          Each platform follows the same recipe: install its adapter package (an optional peer —
          you only carry what you use), collect credentials from the platform&apos;s app settings,
          and pass them through in <InlineCode>platforms</InlineCode>. The config object for each
          platform is a passthrough: whatever the platform needs, the runtime forwards.
        </>
      }
    >
      <Section title="Slack">
        <Code title="terminal">{`pnpm add @chat-adapter/slack`}</Code>
        <p>
          Create an app at <InlineCode>api.slack.com/apps</InlineCode>, add a bot user, install it
          to your workspace, and enable Event Subscriptions for message events. You need the{" "}
          <strong>bot token</strong> (starts with <InlineCode>xoxb-</InlineCode>, under OAuth &amp;
          Permissions) and the <strong>signing secret</strong> (under Basic Information) — the
          runtime uses it to verify every webhook.
        </p>
        <Code title=".env.local">{`SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...`}</Code>
        <Code title="lib/channels.ts">{`platforms: {
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  },
},`}</Code>
      </Section>

      <Section title="Microsoft Teams">
        <Code title="terminal">{`pnpm add @chat-adapter/teams`}</Code>
        <p>
          Teams bots are registered through an Azure Bot resource. You need the bot&apos;s{" "}
          <strong>app id</strong> and <strong>app password</strong> (client secret) from the bot
          registration — consult your Azure bot resource settings for the exact values your tenant
          setup requires.
        </p>
        <Code title=".env.local">{`TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...`}</Code>
        <Code title="lib/channels.ts">{`platforms: {
  teams: {
    appId: process.env.TEAMS_APP_ID!,
    appPassword: process.env.TEAMS_APP_PASSWORD!,
  },
},`}</Code>
      </Section>

      <Section title="Google Chat">
        <Code title="terminal">{`pnpm add @chat-adapter/gchat`}</Code>
        <p>
          Google Chat apps authenticate with a <strong>service account</strong>: enable the Chat
          API in Google Cloud Console, configure the app under Chat API → Configuration, and create
          a service account key. Consult your Google Cloud project settings for the credential
          shape your deployment uses (a JSON key is the common path).
        </p>
        <Code title=".env.local">{`GCHAT_SERVICE_ACCOUNT_KEY={"type":"service_account",...}`}</Code>
        <Code title="lib/channels.ts">{`platforms: {
  gchat: {
    serviceAccountKey: JSON.parse(process.env.GCHAT_SERVICE_ACCOUNT_KEY!),
  },
},`}</Code>
      </Section>

      <Section title="Discord">
        <Code title="terminal">{`pnpm add @chat-adapter/discord`}</Code>
        <p>
          Create an application in the Discord Developer Portal and add a bot to it. You need the{" "}
          <strong>bot token</strong> (under Bot) and the <strong>public key</strong> (under General
          Information) — the public key is what verifies signed webhook requests. Invite the bot to
          your server with the message scopes your use case needs.
        </p>
        <Code title=".env.local">{`DISCORD_BOT_TOKEN=...
DISCORD_PUBLIC_KEY=...`}</Code>
        <Code title="lib/channels.ts">{`platforms: {
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN!,
    publicKey: process.env.DISCORD_PUBLIC_KEY!,
  },
},`}</Code>
      </Section>

      <Section title="Telegram">
        <Code title="terminal">{`pnpm add @chat-adapter/telegram`}</Code>
        <p>
          The simplest of the five: message <InlineCode>@BotFather</InlineCode> on Telegram, create
          a bot, and copy the <strong>bot token</strong> it gives you. That single token covers
          both sending and webhook verification.
        </p>
        <Code title=".env.local">{`TELEGRAM_BOT_TOKEN=123456:ABC-...`}</Code>
        <Code title="lib/channels.ts">{`platforms: {
  telegram: { botToken: process.env.TELEGRAM_BOT_TOKEN! },
},`}</Code>
      </Section>

      <Section title="Everything together">
        <p>
          Enable only what you use — each key in <InlineCode>platforms</InlineCode> produces one
          webhook handler in <InlineCode>channels.webhooks</InlineCode> and nothing else changes:
        </p>
        <Code title="lib/channels.ts">{`export const channels = await createChannels({
  db,
  userName: "ekairos",
  platforms: {
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    },
    telegram: { botToken: process.env.TELEGRAM_BOT_TOKEN! },
    // teams, gchat, discord: same pattern, when you need them
  },
  resolveContextId,
  react,
});`}</Code>
        <Callout>
          Exact credential field names follow each adapter package&apos;s config — when in doubt,
          consult your platform&apos;s app settings and the adapter&apos;s own documentation. The{" "}
          <InlineCode>platforms</InlineCode> object forwards your config verbatim, so there is no
          ekairos-specific translation layer to learn.
        </Callout>
      </Section>

      <Section title="Under the hood">
        <p>
          Platform delivery is built on{" "}
          <a className="underline underline-offset-4" href="https://chat-sdk.dev">
            Vercel&apos;s Chat SDK
          </a>
          , wrapped and contained inside <InlineCode>@ekairos/channel</InlineCode> — its platform
          adapters are the <InlineCode>@chat-adapter/*</InlineCode> packages you install above, and
          they are wrapped too. Nothing of it leaks into your app: you talk to the channel domain
          (<InlineCode>createChannels</InlineCode>, canonical{" "}
          <InlineCode>channel_messages</InlineCode>), and all conversation state lives in InstantDB
          rather than in the delivery layer. Upstream improvements reach you as plain dependency
          bumps — no integration code to rewrite.
        </p>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/guides/webhooks",
              label: "Mount webhooks",
              description: "One catch-all route, background processing, URL registration.",
            },
            {
              href: "/channel/docs/quickstart",
              label: "Quickstart",
              description: "The full path from schema push to live timeline.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

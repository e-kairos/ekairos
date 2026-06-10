import { Callout, Code, DocPage, InlineCode, NextLinks, Section } from "../../_kit";

export const metadata = {
  title: "Channel — Mount webhooks | Ekairos Registry",
  description: "One catch-all route serves every platform: respond fast, process in the background.",
};

export default function ChannelWebhooksGuidePage() {
  return (
    <DocPage
      eyebrow="channel / guides / webhooks"
      title="Mount webhooks."
      lead={
        <>
          Every platform pushes inbound messages to you over HTTP. The runtime gives you one
          pre-built handler per configured platform — your job is a single catch-all route that
          dispatches by path segment. Verification, parsing and persistence are handled inside.
        </>
      }
    >
      <Section title="The catch-all route">
        <p>
          <InlineCode>createChannels</InlineCode> returns{" "}
          <InlineCode>channels.webhooks</InlineCode>: a record with one{" "}
          <InlineCode>(request) =&gt; Response</InlineCode> handler per enabled platform. Mount them
          all under a single dynamic segment:
        </p>
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
        <p>
          That is the whole integration surface. Adding a platform later means adding one entry to{" "}
          <InlineCode>platforms</InlineCode> in <InlineCode>createChannels</InlineCode> — the route
          never changes. When the handler returns, the inbound message is already a canonical{" "}
          <InlineCode>channel_messages</InlineCode> record on InstantDB, so any mounted{" "}
          <InlineCode>ChannelTimeline</InlineCode> shows it reactively the same instant.
        </p>
      </Section>

      <Section title="Respond fast, process in the background">
        <p>
          Platforms enforce tight webhook deadlines (Slack retries after 3 seconds) — but an agent
          reaction can take much longer than that. Each handler accepts a second{" "}
          <InlineCode>options</InlineCode> argument: pass a <InlineCode>waitUntil</InlineCode>{" "}
          function and the handler acknowledges the platform immediately while the inbound pipeline
          (persist → <InlineCode>resolveContextId</InlineCode> → <InlineCode>react</InlineCode> →
          reply) continues after the response is flushed. In Next.js, wire it to{" "}
          <InlineCode>after()</InlineCode>:
        </p>
        <Code title="app/api/channels/[platform]/route.ts">{`import { after } from "next/server";
import { channels } from "@/lib/channels";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const handler = channels.webhooks[platform];
  if (!handler) {
    return new Response("unknown platform", { status: 404 });
  }
  return handler(request, {
    waitUntil: (promise: Promise<unknown>) => after(promise),
  });
}`}</Code>
        <Callout>
          Without <InlineCode>waitUntil</InlineCode>, the handler still works — it just keeps the
          request open until the reaction finishes. Fine in development; on serverless platforms
          with retrying webhooks, pass it so slow reactions never look like failed deliveries.
        </Callout>
      </Section>

      <Section title="Signature verification">
        <p>
          You never verify requests yourself. Each platform handler runs that platform&apos;s own
          verification internally — Slack&apos;s signing-secret HMAC, Telegram&apos;s secret token,
          and so on — using the credentials you passed in <InlineCode>platforms</InlineCode>.
          Requests that fail verification are rejected before any message is persisted or any
          reaction runs.
        </p>
      </Section>

      <Section title="Point each platform at the route">
        <p>
          With the route deployed, register the public URL in each platform&apos;s app
          configuration. The path segment must match the key you used in{" "}
          <InlineCode>platforms</InlineCode>:
        </p>
        <div className="overflow-x-auto border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  platform
                </th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  webhook url
                </th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  where to configure
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">slack</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  https://your-app.com/api/channels/slack
                </td>
                <td className="px-3 py-2 text-sm leading-6 text-muted-foreground">
                  api.slack.com/apps → your app → Event Subscriptions → Request URL
                </td>
              </tr>
              <tr className="border-b border-border align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">teams</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  https://your-app.com/api/channels/teams
                </td>
                <td className="px-3 py-2 text-sm leading-6 text-muted-foreground">
                  Azure portal → your bot resource → Configuration → Messaging endpoint
                </td>
              </tr>
              <tr className="border-b border-border align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">gchat</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  https://your-app.com/api/channels/gchat
                </td>
                <td className="px-3 py-2 text-sm leading-6 text-muted-foreground">
                  Google Cloud Console → Chat API → Configuration → HTTP endpoint URL
                </td>
              </tr>
              <tr className="border-b border-border align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">discord</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  https://your-app.com/api/channels/discord
                </td>
                <td className="px-3 py-2 text-sm leading-6 text-muted-foreground">
                  Discord Developer Portal → your application → General Information → Interactions
                  Endpoint URL
                </td>
              </tr>
              <tr className="align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">telegram</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  https://your-app.com/api/channels/telegram
                </td>
                <td className="px-3 py-2 text-sm leading-6 text-muted-foreground">
                  Bot API call: <InlineCode>setWebhook</InlineCode> with your URL (no dashboard —
                  one HTTPS request)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Code title="terminal — telegram webhook registration">{`curl "https://api.telegram.org/bot\${TELEGRAM_BOT_TOKEN}/setWebhook" \\
  -d "url=https://your-app.com/api/channels/telegram"`}</Code>
        <Callout>
          Platforms verify the URL at registration time (Slack sends a challenge, Discord sends a
          signed ping). Deploy the route first, then register the URL — the handlers answer those
          verification handshakes automatically.
        </Callout>
      </Section>

      <Section title="Troubleshooting">
        <p>
          <strong>404 &quot;unknown platform&quot;.</strong> The path segment did not match any key
          in <InlineCode>channels.webhooks</InlineCode>. Check the registered URL for typos (
          <InlineCode>/api/channels/slack</InlineCode>, not{" "}
          <InlineCode>/api/channel/slack</InlineCode>) and confirm the segment matches the key you
          used in the <InlineCode>platforms</InlineCode> object exactly.
        </p>
        <p>
          <strong>Platform missing from the runtime.</strong>{" "}
          <InlineCode>channels.webhooks</InlineCode> only contains the platforms you configured in{" "}
          <InlineCode>createChannels</InlineCode>. If a platform is absent, it was not in{" "}
          <InlineCode>platforms</InlineCode> when the runtime booted — log{" "}
          <InlineCode>channels.platforms</InlineCode> on startup to see what was actually enabled,
          and check that the adapter package for that platform is installed (they are optional
          peers).
        </p>
        <p>
          <strong>Webhook registers but messages never arrive.</strong> Verify the route is
          deployed and publicly reachable, then check credentials: a wrong signing secret means
          every request fails verification silently from the platform&apos;s point of view (it sees
          non-2xx responses and eventually stops retrying).
        </p>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/guides/platform-setup",
              label: "Platform setup",
              description: "Adapter packages, credentials and env vars per platform.",
            },
            {
              href: "/channel/docs/guides/components",
              label: "UI components",
              description: "Render what the webhooks persist — reactively, with zero glue.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

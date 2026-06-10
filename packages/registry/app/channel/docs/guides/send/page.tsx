import { Callout, Code, DocPage, InlineCode, NextLinks, Section } from "../../_kit";

export const metadata = {
  title: "Channel — Send messages | Ekairos Registry",
  description: "The send endpoint: the one piece of outbound custom code an app owns.",
};

export default function ChannelSendGuidePage() {
  return (
    <DocPage
      eyebrow="channel / guides / send"
      title="Send messages."
      lead={
        <>
          Outbound is deliberately explicit: your app owns one endpoint that decides who can send
          what, through which channel. Everything after that decision — delivery, persistence,
          linking — is the domain&apos;s job.
        </>
      }
    >
      <Section title="Why an endpoint at all">
        <p>
          Reads never need APIs here: timelines are reactive InstantDB queries. Writes are
          different — sending a message is an <strong>action</strong> with authorization, rate
          limits and business rules only your app knows. So the contract is: one POST endpoint,
          owned by you, as small as it can be.
        </p>
      </Section>

      <Section title="The endpoint">
        <Code title="app/api/channels/send/route.ts">{`import { createChannelMessage, ChannelRegistry } from "@ekairos/channel";
import { channels } from "@/lib/channels";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const { channel, text, contextId, threadKey } = await request.json();

  // 1. Your rules: who can send, to which thread, on which channel.
  await assertCanSend({ request, contextId, channel });

  // 2. Web channel: persist the canonical message; the timeline updates
  //    reactively, and the agent can react to it like any other input.
  if (channel === "web") {
    await channels.store.saveChannelMessage(
      createChannelMessage({
        channel,
        direction: "outbound",
        role: "user",
        text,
        contextId,
      }),
    );
    return Response.json({ ok: true });
  }

  // 3. Platform channels: deliver through the registered adapter, then
  //    persist the canonical outbound record on the same context.
  const result = await registry.send({ channel, text, contextId, participant: threadKey });
  await channels.store.saveChannelMessage(
    createChannelMessage({
      channel,
      direction: "outbound",
      role: "assistant",
      text,
      status: result.status,
      externalId: result.externalId,
      contextId,
    }),
  );
  return Response.json({ ok: true });
}`}</Code>
        <Callout>
          Replies inside an inbound flow are even simpler: the{" "}
          <InlineCode>react</InlineCode> callback of <InlineCode>createChannels</InlineCode> receives{" "}
          <InlineCode>inbound.reply(text)</InlineCode>, which posts on the same platform
          conversation and persists the outbound record in one call. The endpoint above is for
          product-initiated sends.
        </Callout>
      </Section>

      <Section title="Custom delivery: the adapter contract">
        <p>
          Email through your provider, SMS, push — anything can be a channel. Implement{" "}
          <InlineCode>ChannelAdapter</InlineCode> and register it; the canonical model stays
          identical, so timelines and components need zero changes:
        </p>
        <Code title="lib/channels/email-adapter.ts">{`import { ChannelRegistry, type ChannelAdapter } from "@ekairos/channel";

const emailAdapter: ChannelAdapter = {
  kind: "email",
  async send(message) {
    const sent = await resend.emails.send({
      to: message.participant!,
      subject: "Re: your thread",
      text: message.text ?? "",
    });
    return { externalId: sent.data?.id, status: "sent" };
  },
};

export const registry = new ChannelRegistry().register(emailAdapter);`}</Code>
      </Section>

      <Section title="Wire the composer">
        <Code title="ui">{`<ChannelComposer
  endpoint="/api/channels/send"
  contextId={contextId}
  channels={["web", "email", "whatsapp"]}
/>`}</Code>
        <p>
          <InlineCode>ChannelComposer</InlineCode> POSTs{" "}
          <InlineCode>{`{ channel, text, contextId, threadKey }`}</InlineCode> to your endpoint and
          nothing else — the channel picker, busy state and keyboard handling come built in. Install
          it with{" "}
          <InlineCode>shadcn add https://registry.ekairos.dev/r/channel-composer.json</InlineCode>.
        </p>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/reference/adapters",
              label: "Adapters & registry",
              description: "The full ChannelAdapter and ChannelRegistry reference.",
            },
            {
              href: "/channel/docs/guides/components",
              label: "UI components",
              description: "Timeline, bubbles, badges and composer.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

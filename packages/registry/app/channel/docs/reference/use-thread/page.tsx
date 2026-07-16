import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";

export const metadata = {
  title: "Channel — useThread integration | Ekairos Registry",
  description:
    "API reference for useThread from @ekairos/agent/react: ThreadValue, ThreadEventForUI, ThreadTimelineEntry, and buildThreadTimelineQuery.",
};

export default function UseThreadReferencePage() {
  return (
    <DocPage
      eyebrow="channel / reference"
      title="useThread integration"
      lead={
        <>
          <InlineCode>useThread</InlineCode> lives in the agent domain (
          <InlineCode>@ekairos/agent/react</InlineCode>) and is where channel meets the UI: one hook
          returns the whole multichannel conversation — the thread, its context events, and every{" "}
          <InlineCode>channel_messages</InlineCode> record attached to the context — as reactive
          InstantDB queries. Only <InlineCode>append</InlineCode> touches the reaction endpoint.
        </>
      }
    >
      <Section title="How channel plugs in">
        <p>
          Internally the hook composes three reactive queries: <InlineCode>agent_threads</InlineCode>{" "}
          by key (to resolve the <InlineCode>contextId</InlineCode>), the context with its{" "}
          <InlineCode>context_events</InlineCode> and their linked{" "}
          <InlineCode>channelMessages</InlineCode>, and all{" "}
          <InlineCode>channel_messages</InlineCode> on the context ordered by{" "}
          <InlineCode>createdAt</InlineCode>. The channel domain links (
          <InlineCode>context</InlineCode>, <InlineCode>item</InlineCode>) are what make this
          possible without any data API: a whatsapp reply appears in the timeline the moment the
          webhook persists it.
        </p>
      </Section>

      <Section title="Signature">
        <Code title="@ekairos/agent/react">{`export function useThread(db: any, options: UseThreadOptions): ThreadValue`}</Code>
        <PropsTable
          rows={[
            {
              name: "db",
              type: "any",
              required: true,
              description: <>InstantDB react client (the one with <InlineCode>useQuery</InlineCode>).</>,
            },
            {
              name: "options.key",
              type: "string",
              required: true,
              description: (
                <>
                  Stable thread key (<InlineCode>agent_threads.key</InlineCode>). The hook resolves
                  the thread and its context from it.
                </>
              ),
            },
            {
              name: "options.apiUrl",
              type: "string",
              required: true,
              description: (
                <>
                  Endpoint that runs the thread reaction server-side (<InlineCode>append</InlineCode>{" "}
                  posts here). Reads never go through it: data is reactive InstantDB.
                </>
              ),
            },
            {
              name: "options.onContextUpdate",
              type: 'UseContextOptions["onContextUpdate"]',
              description: <>Callback fired when the context updates.</>,
            },
            {
              name: "options.prepareAppendArgs",
              type: 'UseContextOptions["prepareAppendArgs"]',
              description: <>Transforms the arguments before <InlineCode>append</InlineCode> sends them.</>,
            },
            {
              name: "options.prepareRequestBody",
              type: 'UseContextOptions["prepareRequestBody"]',
              description: <>Customizes the request body posted to <InlineCode>apiUrl</InlineCode>.</>,
            },
            {
              name: "options.enableResumableStreams",
              type: 'UseContextOptions["enableResumableStreams"]',
              description: <>Opts into resumable streaming for in-flight turns.</>,
            },
          ]}
        />
      </Section>

      <Section title="ThreadValue">
        <Code title="type">{`export type ThreadValue = ContextValue & {
  thread: ThreadMeta | null;
  /** Every channel message attached to the thread's context. */
  messages: ChannelMessage[];
  /** Context events + unattached channel messages, in chronological order. */
  timeline: ThreadTimelineEntry[];
};`}</Code>
        <PropsTable
          rows={[
            {
              name: "thread",
              type: "ThreadMeta | null",
              description: (
                <>
                  Thread metadata (<InlineCode>id</InlineCode>, <InlineCode>key</InlineCode>,{" "}
                  <InlineCode>title</InlineCode>, <InlineCode>status</InlineCode>, timestamps,{" "}
                  <InlineCode>contextId</InlineCode>); <InlineCode>null</InlineCode> until the
                  thread row loads.
                </>
              ),
            },
            {
              name: "messages",
              type: "ChannelMessage[]",
              description: (
                <>
                  Every channel message attached to the thread&apos;s context, ordered by{" "}
                  <InlineCode>createdAt</InlineCode>, with <InlineCode>itemId</InlineCode>/
                  <InlineCode>contextId</InlineCode> resolved from the links.
                </>
              ),
            },
            {
              name: "timeline",
              type: "ThreadTimelineEntry[]",
              description: (
                <>Context events + unattached channel messages, in chronological order.</>
              ),
            },
          ]}
        />
        <p>
          Inherited from <InlineCode>ContextValue</InlineCode> (the reactive context surface from{" "}
          <InlineCode>@ekairos/events/react</InlineCode>):
        </p>
        <PropsTable
          rows={[
            {
              name: "events",
              type: "ContextEventForUI[]",
              description: (
                <>
                  The context items in order. In <InlineCode>useThread</InlineCode> they come from
                  the thread state query and carry their linked{" "}
                  <InlineCode>channelMessages</InlineCode> — cast to{" "}
                  <InlineCode>ThreadEventForUI[]</InlineCode> when you need that field.
                </>
              ),
            },
            {
              name: "append",
              type: "(args: AppendArgs) => Promise<void>",
              description: (
                <>
                  Posts a new user turn to <InlineCode>apiUrl</InlineCode>, triggering the thread
                  reaction server-side. The only call that leaves the client.
                </>
              ),
            },
            {
              name: "stop",
              type: "() => void",
              description: <>Stops the in-flight turn.</>,
            },
            {
              name: "contextStatus",
              type: "ContextStatus",
              description: (
                <>
                  Live status of the context (e.g. <InlineCode>open_idle</InlineCode>, running
                  states), derived reactively from the context row.
                </>
              ),
            },
            {
              name: "sendStatus",
              type: "SendStatus",
              description: <>Status of the current <InlineCode>append</InlineCode> request.</>,
            },
            {
              name: "context, contextId, sendError, ...",
              type: "ContextValue",
              description: (
                <>
                  The rest of <InlineCode>ContextValue</InlineCode> carries over as-is:{" "}
                  <InlineCode>apiUrl</InlineCode>, <InlineCode>context</InlineCode>,{" "}
                  <InlineCode>contextId</InlineCode>, <InlineCode>activeExecutionId</InlineCode>,{" "}
                  <InlineCode>turnSubstateKey</InlineCode>, <InlineCode>sendError</InlineCode>.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section title="ThreadEventForUI">
        <Code title="type">{`/** A context event enriched with the channel messages linked to it. */
export type ThreadEventForUI = ContextEventForUI & {
  channelMessages?: ChannelMessage[];
};`}</Code>
        <PropsTable
          rows={[
            {
              name: "channelMessages",
              type: "ChannelMessage[]",
              description: (
                <>
                  The channel messages anchored to this event via the{" "}
                  <InlineCode>channel_messagesItem</InlineCode> link — e.g. the outbound email an
                  agent turn produced. Render them inside the event.
                </>
              ),
            },
            {
              name: "...ContextEventForUI",
              type: "inherited",
              description: <>Everything a context event already exposes to the UI.</>,
            },
          ]}
        />
      </Section>

      <Section title="ThreadTimelineEntry">
        <Code title="type">{`/** One conversation timeline across every channel: context events interleaved
 * with channel messages (email, whatsapp, slack, ...) that are not already
 * attached to an event. */
export type ThreadTimelineEntry =
  | { kind: "event"; at: string; event: ThreadEventForUI }
  | { kind: "message"; at: string; message: ChannelMessage };`}</Code>
        <PropsTable
          rows={[
            {
              name: 'kind: "event"',
              type: "{ kind: 'event'; at: string; event: ThreadEventForUI }",
              description: (
                <>
                  A context event, stamped with its <InlineCode>createdAt</InlineCode> as ISO{" "}
                  <InlineCode>at</InlineCode>. Its anchored channel messages travel inside{" "}
                  <InlineCode>event.channelMessages</InlineCode>.
                </>
              ),
            },
            {
              name: 'kind: "message"',
              type: "{ kind: 'message'; at: string; message: ChannelMessage }",
              description: (
                <>
                  A channel message that is <strong>not</strong> anchored to any event — e.g. an
                  inbound whatsapp that arrived between turns, or a broadcast you sent from the
                  product.
                </>
              ),
            },
          ]}
        />
        <Callout>
          <strong>The timeline rule:</strong> messages anchored to an item (their{" "}
          <InlineCode>id</InlineCode> appears in some event&apos;s{" "}
          <InlineCode>channelMessages</InlineCode>) are rendered <em>inside</em> that event and
          skipped as standalone entries; unanchored messages are interleaved with the events,
          sorted chronologically by <InlineCode>at</InlineCode>. No message appears twice.
        </Callout>
      </Section>

      <Section title="buildThreadTimelineQuery">
        <p>
          For manual queries — server components, scripts, or custom hooks — the agent domain
          exports the exact InstantDB query <InlineCode>useThread</InlineCode> is built on: the
          thread, its context items in order, and the channel messages linked to each item and to
          the context.
        </p>
        <Code title="@ekairos/agent">{`export function buildThreadTimelineQuery(threadKey: string) {
  return {
    agent_threads: {
      $: { where: { key: threadKey } },
      context: {
        items: {
          $: { order: { createdAt: "asc" as const } },
          channelMessages: {},
        },
        channelMessages: {},
      },
    },
  };
}`}</Code>
        <Code title="usage">{`import { buildThreadTimelineQuery } from "@ekairos/agent";

// reactive, client-side
const { data } = db.useQuery(buildThreadTimelineQuery("whatsapp:+5491155550123"));

// one-shot, server-side (admin client)
const result = await adminDb.query(buildThreadTimelineQuery("whatsapp:+5491155550123"));`}</Code>
      </Section>

      <Section title="Rendering the timeline">
        <Code title="app/threads/[key]/thread-view.tsx">{`"use client";

import { useThread, type ThreadEventForUI } from "@ekairos/agent/react";
import type { ChannelMessage } from "@ekairos/channel";
import { db } from "@/lib/db.client";

export function ThreadView({ threadKey }: { threadKey: string }) {
  const { thread, timeline, append, sendStatus } = useThread(db, {
    key: threadKey,
    apiUrl: "/api/thread",
  });

  return (
    <div>
      <h1>{thread?.title ?? threadKey}</h1>
      <ol>
        {timeline.map((entry) =>
          entry.kind === "event" ? (
            <EventEntry key={entry.event.id} event={entry.event} />
          ) : (
            <MessageBubble key={entry.message.id} message={entry.message} />
          ),
        )}
      </ol>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("text") as HTMLInputElement;
          await append({ text: input.value });
          input.value = "";
        }}
      >
        <input name="text" disabled={sendStatus === "submitted"} />
      </form>
    </div>
  );
}

function EventEntry({ event }: { event: ThreadEventForUI }) {
  return (
    <li>
      <article>{/* render the agent event (text, reasoning, tools) */}</article>
      {/* anchored channel messages render inside their event */}
      {event.channelMessages?.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </li>
  );
}

function MessageBubble({ message }: { message: ChannelMessage }) {
  return (
    <li data-direction={message.direction}>
      <span>{message.channel}</span>
      <p>{message.text}</p>
      <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
    </li>
  );
}`}</Code>
        <p>
          One branch on <InlineCode>entry.kind</InlineCode> covers the whole multichannel
          conversation: agent events (with their anchored deliveries inside) and free-standing
          channel messages, in one chronological stream.
        </p>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/reference/channel-message",
              label: "Reference: ChannelMessage",
              description: "The message type the timeline interleaves.",
            },
            {
              href: "/channel/docs/reference/schema",
              label: "Reference: Schema",
              description: "The links that anchor messages to contexts and items.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

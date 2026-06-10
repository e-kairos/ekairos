import { Callout, Code, DocPage, InlineCode, NextLinks, PropsTable, Section } from "../../_kit";

export const metadata = {
  title: "Channel — Runtime state | Ekairos Registry",
  description:
    "channel_state, channel_locks, channel_subscriptions and channel_queues: how delivery state persists on InstantDB with no extra infrastructure.",
};

export default function ChannelStateConceptPage() {
  return (
    <DocPage
      eyebrow="channel / concepts"
      title="Runtime state"
      lead={
        <>
          Multichannel delivery needs working memory: locks so one conversation gets one reply at a
          time, queues for messages that arrive mid-reaction, subscriptions that outlive a deploy.
          The channel domain keeps all of it in four internal InstantDB entities — no Redis, no
          extra infrastructure, nothing for you to operate.
        </>
      }
    >
      <Section title="All state, one database">
        <p>
          The delivery runtime is backed by a state adapter that persists everything — key-value
          pairs with TTL, per-conversation locks, durable subscriptions, ordered queues — on the
          same InstantDB app that holds your <InlineCode>channel_messages</InlineCode>. Pushing the
          channel schema provisions all of it; there is no second datastore to deploy, secure or
          monitor, and a fresh process resumes from exactly where the previous one stopped.
        </p>
        <Callout>
          These four entities are <strong>internal to the domain</strong>. They are owned and
          mutated exclusively by the delivery runtime; your application never queries them, never
          writes them, and should never link to them. The public surface remains{" "}
          <InlineCode>channel_messages</InlineCode> and the <InlineCode>createChannels</InlineCode>{" "}
          callbacks — runtime state is plumbing that happens to be visible in your schema.
        </Callout>
      </Section>

      <Section title="Entity reference">
        <PropsTable
          rows={[
            {
              name: "channel_state",
              type: "KV + TTL",
              description: (
                <>
                  General key-value store: unique indexed <InlineCode>key</InlineCode>, JSON{" "}
                  <InlineCode>value</InlineCode>, optional <InlineCode>expiresAt</InlineCode>. Backs
                  caches, dedupe markers, set-if-not-exists guards and bounded lists. Expired rows
                  are deleted lazily on the next read.
                </>
              ),
            },
            {
              name: "channel_locks",
              type: "token + TTL",
              description: (
                <>
                  One row per conversation (<InlineCode>threadId</InlineCode> is unique), holding a
                  random <InlineCode>token</InlineCode> and an <InlineCode>expiresAt</InlineCode>.
                  Guarantees a single active delivery per conversation; the token ensures only the
                  holder can extend or release.
                </>
              ),
            },
            {
              name: "channel_subscriptions",
              type: "durable set",
              description: (
                <>
                  The set of platform conversations the runtime is actively following, one row per{" "}
                  <InlineCode>threadId</InlineCode>. Because it is a table rather than process
                  memory, subscriptions survive restarts and redeploys.
                </>
              ),
            },
            {
              name: "channel_queues",
              type: "ordered entries",
              description: (
                <>
                  Per-conversation FIFO: <InlineCode>threadId</InlineCode> plus a monotonic{" "}
                  <InlineCode>seq</InlineCode> and a JSON <InlineCode>entry</InlineCode>. Holds
                  messages that arrive while a handler is already running, dequeued in{" "}
                  <InlineCode>seq</InlineCode> order with a bounded depth.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section title="Locks: one delivery per conversation">
        <p>
          When an inbound message starts a reaction, the runtime first acquires the lock for that
          conversation. Acquisition follows a simple protocol: if a non-expired lock row exists, the
          attempt fails and the caller backs off; if the row is expired, it is taken over with a
          fresh token; if no row exists, one is inserted — and the unique index on{" "}
          <InlineCode>threadId</InlineCode> turns a concurrent double-insert into a caught error,
          so exactly one racer wins.
        </p>
        <Code title="the lock lifecycle">{`acquire(threadId, ttl)  ->  { threadId, token, expiresAt } | null
extend(lock, ttl)       ->  true only if the stored token still matches
release(lock)           ->  deletes only if the stored token still matches`}</Code>
        <p>
          The token check on extend and release is the fencing mechanism: a handler that stalled
          past its TTL and lost the lock to a newer acquirer cannot release the newer holder&apos;s
          lock by accident. Long reactions extend the lock as they go; a crashed process simply lets
          its TTL lapse, and the conversation unblocks on its own.
        </p>
      </Section>

      <Section title="Subscriptions and queues">
        <p>
          <strong>Subscriptions</strong> record which conversations the runtime cares about. On
          restart the runtime reads the table back and resumes following every conversation it was
          following before — no platform re-handshake, no lost threads after a deploy.
        </p>
        <p>
          <strong>Queues</strong> absorb concurrency instead of dropping it. If a user sends three
          messages while the agent is still reacting to the first, the lock rejects parallel
          handling and the runtime enqueues the extras with increasing <InlineCode>seq</InlineCode>{" "}
          values. When the running handler finishes and releases the lock, queued entries drain in
          order — each one a fresh reaction against an up-to-date context. Queue depth is bounded,
          so a flood degrades by refusing new entries rather than by growing without limit.
        </p>
      </Section>

      <Section title="Atomicity is best-effort in v1">
        <Callout tone="warning">
          The v1 state adapter does not use database-level compare-and-swap. Concurrency safety
          leans on two guards: <strong>unique indexes</strong> on{" "}
          <InlineCode>channel_locks.threadId</InlineCode> and{" "}
          <InlineCode>channel_state.key</InlineCode> make conflicting inserts fail loudly (the
          insert race is safe), and <strong>expiry is enforced on read</strong>, so a stale row is
          treated as absent the moment any reader sees it. What this does not cover: a
          read-then-update on an <em>expired-but-present</em> lock can in principle race two
          takeover attempts, and TTL correctness assumes reasonably synchronized clocks. In
          practice the lock TTLs and token fencing make the window small and the failure mode mild
          — at worst a duplicated reaction attempt, never a corrupted record. If your deployment
          needs strict mutual exclusion under hostile concurrency, treat this as the known
          limitation of v1.
        </Callout>
        <p>
          The trade was deliberate: best-effort atomicity on InstantDB buys zero extra
          infrastructure, full reactivity over the runtime&apos;s own state, and one consistent
          backup/permissions story for the whole domain. The adapter interface is narrow, so a
          stricter backend can replace it without touching anything above.
        </p>
      </Section>

      <Section title="Next">
        <NextLinks
          links={[
            {
              href: "/channel/docs/concepts/platforms",
              label: "Platforms",
              description: "The unified inbound pipeline this state machinery keeps orderly.",
            },
            {
              href: "/channel/docs/reference/schema",
              label: "Schema reference",
              description: "Every entity and link the channel domain pushes to InstantDB.",
            },
          ]}
        />
      </Section>
    </DocPage>
  );
}

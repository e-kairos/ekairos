import { Callout, Code, DocPage, Evidence, Invariants, NextLinks, Section } from "../_kit"

export default function ObservabilityPage() {
  return (
    <DocPage
      eyebrow="Reaction Engine / Observability"
      title="The UI streams Event Parts and derives state from Sessions."
      lead="Clients subscribe to one Context graph. New Parts make model messages, reasoning, sources, and action progress visible while the current Session determines running, failed, or idle state."
    >
      <Section title="React hook">
        <Code>{`const {
  context,
  contextId,
  contextStatus,
  activeSessionId,
  sessions,
  reactions,
  events,
  append,
} = useContext(db, {
  apiUrl: "/api/support/react",
  contextKey,
})`}</Code>
        <Invariants items={[
          "Optimistic input Events reconcile by Event id.",
          "Events and Parts are sorted by createdAt and index.",
          "Reactions are sorted by position within a Session.",
          "Action calls render from started, completed, and failed Parts.",
          "Child Sessions remain independently inspectable.",
        ]} />
      </Section>

      <Section title="Canonical Part stream">
        <Code>{`context_eventParts: {
  key: "event-id:0",
  index: 0,
  type: "action",
  content: {
    status: "completed",
    actionName: "requisition.addItems",
    actionCallId: "...",
    output: { added: 12 },
  },
}`}</Code>
        <Callout>Provider ids and usage remain metadata. The semantic Part fields stay stable across OpenAI, Claude, Cursor, and deterministic engines.</Callout>
      </Section>

      <Section title="Evidence">
        <Evidence ids={["stream-hook", "reaction-view", "reaction-view-test", "workflow-smoke"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/testing", label: "Testing", detail: "Verify both durable graph and visible Parts." },
        { href: "/reactor/docs/api", label: "API reference", detail: "See the complete public surface." },
      ]} />
    </DocPage>
  )
}

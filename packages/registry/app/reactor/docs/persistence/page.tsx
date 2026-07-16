import { Code, DocPage, Evidence, Graph, Invariants, NextLinks, Section } from "../_kit"

export default function PersistencePage() {
  return (
    <DocPage
      eyebrow="Reaction Engine / Persistence"
      title="Five entities describe the complete causal journal."
      lead="Context is durable data, Session is invocation, Reaction is causality, Event is fact or result, and Event Part is ordered content."
    >
      <Section title="Canonical graph">
        <Graph>{`context_contexts
+- context_sessions
   |- trigger -> context_events
   |- parent / children -> context_sessions
   |- rootReaction -> context_reactions
   +- reactions -> context_reactions
      |- causes  -> context_events[]
      +- effects -> context_events[]
                     +- eventParts -> context_eventParts[]`}</Graph>
        <Invariants items={[
          "Session status is running, completed, or failed.",
          "Reaction causeIds and effectIds preserve deterministic order.",
          "Real InstantDB links make the same graph traversable.",
          "Operation type and instruction live on the Reaction.",
          "Operation payload and streamable content live on its effect Event.",
        ]} />
      </Section>

      <Section title="Reactive query">
        <Code>{`context_contexts: {
  $: { where: { key: contextKey }, limit: 1 },
  currentSession: {},
  events: {
    eventParts: { $: { order: { index: "asc" } } },
  },
  sessions: {
    trigger: {},
    rootReaction: { causes: {}, effects: {} },
    reactions: {
      causes: {},
      effects: {},
      parent: {},
    },
    children: {},
  },
}`}</Code>
      </Section>

      <Section title="Evidence">
        <Evidence ids={["context-schema", "context-store", "instant-store", "event-persistence-test", "reaction-graph-test"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/observability", label: "Event Parts and UI", detail: "Turn the graph into live interface state." },
        { href: "/reactor/docs/testing", label: "Testing", detail: "Assert the graph through temporary InstantDB apps." },
      ]} />
    </DocPage>
  )
}

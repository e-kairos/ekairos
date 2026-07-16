import { Callout, Code, DocPage, Evidence, Invariants, NextLinks, Section } from "../_kit"

export default function EventsPage() {
  return (
    <DocPage
      eyebrow="Reaction Engine / Events"
      title="Events are domain facts, not AI message shapes."
      lead="The domain owns typed payloads and InstantDB relations. The Event envelope adds transport metadata and optional Parts without coupling the Event definition to a model provider."
    >
      <Section title="Define and emit">
        <Code>{`const messageReceived = defineEvent({
  payload: z.object({ message: z.string() }),
  links: {
    requisition: { on: "requisition_requisitions", has: "one" },
    files: { on: "$files", has: "many" },
  },
})

const event = await Events(runtime).emit(
  requisition.events.messageReceived({ message: inbound.text }).link({
    requisition: inbound.requisitionId,
    files: inbound.fileIds,
  }),
  {
    contextId: context.id,
    channel: "email",
    createdAt: inbound.receivedAt,
    metadata: { providerMessageId: inbound.id },
  },
)`}</Code>
        <Callout>The payload remains business data. File ids are real links and are projected only when a selected Event becomes model input.</Callout>
      </Section>

      <Section title="Select history explicitly">
        <Code>{`const history = await Events(runtime).query({
  $: {
    where: {
      "context.id": reaction.context.id,
      domain: "requisition",
    },
    order: { createdAt: "asc" },
  },
})

const answer = await reaction.given(history).agent({
  instruction: "Answer the newest request from this selected history.",
})`}</Code>
        <Invariants items={[
          "The query shape is the selection nested under context_events.",
          "Events keep createdAt, channel, payload, links, and metadata.",
          "Supported text, image, and PDF file content follows a stable file header.",
          "Unsupported or unavailable content remains visible as metadata-only.",
        ]} />
      </Section>

      <Section title="Evidence">
        <Evidence ids={["event-builder", "event-query-test", "event-persistence-test", "reaction-view-test"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/causality", label: "Given and branches", detail: "Use selected Events as causal inputs." },
        { href: "/reactor/docs/observability", label: "Event Parts and UI", detail: "Render the durable stream attached to Events." },
      ]} />
    </DocPage>
  )
}

import { Callout, Code, DocPage, Evidence, Invariants, NextLinks, Section } from "../_kit"

export default function AgentPage() {
  return (
    <DocPage
      eyebrow="Reaction Engine / Agent"
      title="One model primitive, constrained by domain actions."
      lead="Agent handles text or structured model output and may execute only the registered scoped actions supplied by the Reaction. Deterministic writes use the same actions directly."
    >
      <Section title="Structured output">
        <Code>{`const assessment = await reaction.given(reaction.trigger).agent({
  instruction: "Assess the request from the selected evidence.",
  output: z.object({
    approved: z.boolean(),
    reasons: z.array(z.string()),
  }),
})

assessment.payload.approved`}</Code>
      </Section>

      <Section title="Model-selected actions">
        <Code>{`const answer = await reaction.given(assessment).agent({
  instruction: "Persist justified items and return the customer answer.",
  output: answerSchema,
  actions: [
    requisition.actions.addItems.scope({
      requisitionId: reaction.trigger.links.requisition,
    }),
  ],
})`}</Code>
        <Callout>Arbitrary callbacks are not accepted. Scope validation happens when the definition runs, and action input/output is validated around the domain runtime.</Callout>
      </Section>

      <Section title="Deterministic action">
        <Code>{`const saved = await reaction.given(assessment).action(
  requisition.actions.recordAssessment.scope({ requisitionId }),
  assessment.payload,
)`}</Code>
        <Invariants items={[
          "Agent is the only model-backed operation.",
          "A Zod output schema defines the typed Event payload.",
          "Each action call persists started and completed or failed Parts.",
          "Action names remain canonical domain.action names in the journal.",
        ]} />
      </Section>

      <Section title="Evidence">
        <Evidence ids={["agent-runtime", "operation-runtime", "reaction-graph-test", "runtime-boundary-test"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/dataset", label: "Dataset", detail: "Materialize formal collections from causal Events." },
        { href: "/reactor/docs/observability", label: "Event Parts and UI", detail: "Inspect every action and model result." },
      ]} />
    </DocPage>
  )
}

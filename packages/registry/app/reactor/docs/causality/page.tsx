import { Code, DocPage, Evidence, Graph, Invariants, NextLinks, Section } from "../_kit"

export default function CausalityPage() {
  return (
    <DocPage
      eyebrow="Reaction Engine / Causality"
      title="Given selects exactly what causes the next operation."
      lead="An operation consumes one Event or one ordered Event array. Its result is another persisted Event, so the sequence remains readable in code and traversable in InstantDB."
    >
      <Section title="Linear flow">
        <Code>{`const normalized = await reaction.given(reaction.trigger).agent({
  instruction: "Normalize the requisition.",
  output: normalizedSchema,
})

const checked = await reaction.given(normalized).agent({
  instruction: "Check the normalized constraints.",
  output: checkedSchema,
})

return await reaction.given(checked).emit(
  requisition.events.checked(checked.payload),
)`}</Code>
      </Section>

      <Section title="Parallel branches and fan-in">
        <Code>{`const [items, risks] = await Promise.all([
  reaction.given(normalized).dataset({
    instruction: "Extract requested items.",
    schema: itemSchema,
  }),
  reaction.given(normalized).agent({
    instruction: "Assess commercial risks.",
    output: riskSchema,
  }),
])

const decision = await reaction.given([items, risks]).agent({
  instruction: "Decide using both branches.",
  output: decisionSchema,
})`}</Code>
        <Graph>{`normalized
|- dataset -> items
|- agent   -> risks
+- [items, risks] -> agent -> decision`}</Graph>
        <Invariants items={[
          "Array order is the model projection order.",
          "Duplicate Event ids are removed without changing first occurrence order.",
          "Starting calls before Promise.all permits real concurrency.",
          "No trigger or history is silently appended to the selection.",
        ]} />
      </Section>

      <Section title="Evidence">
        <Evidence ids={["reaction-contract", "reaction-graph-test", "reaction-view", "reaction-view-test"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/agent", label: "Agent and actions", detail: "Run model work and registered writes." },
        { href: "/reactor/docs/children", label: "Child reactions", detail: "Create a nested Session boundary." },
      ]} />
    </DocPage>
  )
}

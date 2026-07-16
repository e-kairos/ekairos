import { Code, DocPage, Evidence, Graph, Invariants, NextLinks, Section } from "../_kit"

export default function ChildrenPage() {
  return (
    <DocPage
      eyebrow="Reaction Engine / Children"
      title="A child Reaction is a real child Session."
      lead="Nested work starts from a persisted Event and returns persisted effect Events. The parent sees that public boundary while the child keeps its own internal operation graph."
    >
      <Section title="Shared Context">
        <Code>{`const requested = await reaction.given(repository).emit(
  review.events.requested({ repository: repository.payload.path }),
)

const reviewed = await reaction.react(
  requested,
  defineReaction(
    review.events.requested,
    {
      key: "repository.review",
      scope: review,
      engine: reviewEngine,
      sandbox: reaction.sandboxId ?? false,
    },
    async child => {
      const result = await child.given(child.trigger).agent({
        instruction: "Review the repository and run relevant checks.",
        output: reviewSchema,
      })
      return await child.given(result).emit(
        review.events.completed(result.payload),
      )
    },
  ),
)`}</Code>
      </Section>

      <Section title="Isolated Context">
        <Code>{`const isolated = await Context(runtime).create({
  key: "review:" + reaction.id,
  content: { policy: "independent-review" },
})

const reviewed = await reaction.react(
  isolated,
  requested,
  reviewDefinition,
)`}</Code>
        <Invariants items={[
          "Every child has its own Session and root Reaction.",
          "The child Session links to its parent Session.",
          "Sharing Context is the default; isolation is explicit.",
          "Only persisted Events cross the Session boundary.",
        ]} />
        <Graph>{`parent Session
|- child-boundary Reaction
|  causes  -> review.requested
|  effects -> review.completed
+- child Session
   |- trigger -> review.requested
   +- root effect -> review.completed`}</Graph>
      </Section>

      <Section title="Evidence">
        <Evidence ids={["reaction-contract", "context-reaction-test", "dataset-test"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/persistence", label: "Persistence graph", detail: "Inspect Session ancestry and causal links." },
        { href: "/reactor/docs/examples", label: "Complete examples", detail: "Apply nesting to repository review." },
      ]} />
    </DocPage>
  )
}

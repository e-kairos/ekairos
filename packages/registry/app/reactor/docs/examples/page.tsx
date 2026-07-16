import { Code, DocPage, Evidence, Graph, NextLinks, Section } from "../_kit"

export default function ExamplesPage() {
  return (
    <DocPage
      eyebrow="Reaction Engine / Examples"
      title="A requisition flow with files, Dataset, actions, and review."
      lead="The complete example keeps domain facts, causal selection, model work, deterministic writes, and nested review visible without introducing another orchestration vocabulary."
    >
      <Section title="Definition">
        <Code>{`const processRequisition = defineReaction(
  requisition.events.messageReceived,
  {
    key: "requisition.process",
    scope: requisition,
    engine: ai({ model: "openai/gpt-5.4" }),
    sandbox: ({ context }) => "requisition:" + context.requisition.id,
  },
  async reaction => {
    const files = await reaction.given(reaction.trigger).workspace({
      files: reaction.trigger.links.files ?? [],
      directory: "requisition",
      conflict: "verify",
    })

    const [items, risks] = await Promise.all([
      reaction.given(reaction.trigger).dataset({
        instruction: "Extract every requested item.",
        schema: itemSchema,
      }),
      reaction.given(files).agent({
        instruction: "Assess commercial and technical risks.",
        output: riskSchema,
      }),
    ])

    const saved = await reaction.given([items, risks]).action(
      requisition.actions.recordAnalysis.scope({
        requisitionId: reaction.context.content.requisition.id,
      }),
      { items: items.payload, risks: risks.payload },
    )

    const reviewRequested = await reaction.given(saved).emit(
      requisition.events.reviewRequested({ analysisId: saved.payload.id }),
    )

    const reviewed = await reaction.react(reviewRequested, reviewDefinition)

    return await reaction.given(reviewed).emit(
      requisition.events.answered({
        message: reviewed.payload.summary,
      }),
    )
  },
)`}</Code>
      </Section>

      <Section title="Resulting graph">
        <Graph>{`messageReceived
|- workspace -> files
|- dataset   -> items -> child Dataset Session
|- files -> agent -> risks
+- [items, risks] -> action -> saved
   +- emit -> reviewRequested
      +- child review Session -> reviewCompleted
         +- emit -> answered`}</Graph>
      </Section>

      <Section title="Repository coding">
        <Code>{`const repository = await reaction.given(reaction.trigger).git({
  operation: "clone",
  url: reaction.context.content.repositoryUrl,
  target: "repository",
})
const status = await reaction.given(repository).shell({
  command: "git",
  args: ["-C", repository.payload.path, "status", "--short"],
})
const result = await reaction.given(status).agent({
  instruction: reaction.context.content.request,
  output: codingResultSchema,
})`}</Code>
      </Section>

      <Section title="Evidence">
        <Evidence ids={["reaction-graph-test", "context-reaction-test", "channel-reaction-test", "lab-reaction"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/testing", label: "Testing", detail: "Prove each layer of this graph." },
        { href: "/reactor/docs/api", label: "API reference", detail: "Review every operation signature." },
      ]} />
    </DocPage>
  )
}

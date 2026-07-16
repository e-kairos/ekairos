import { Callout, Code, DocPage, Evidence, Graph, Invariants, NextLinks, Section } from "../_kit"

export default function DatasetPage() {
  return (
    <DocPage
      eyebrow="Reaction Engine / Dataset"
      title="A formal collection produced from selected Events."
      lead="Dataset derives an explicit source from the current causal selection, materializes durable records in a child Session, and returns a small typed handle to the parent."
    >
      <Section title="Reaction operation">
        <Code>{`const items = await reaction.given(reaction.trigger).dataset({
  instruction: "Extract one row per requested item with evidence.",
  schema: z.object({
    code: z.string(),
    description: z.string(),
    quantity: z.number().positive(),
  }),
})

items.payload.datasetId
items.payload.mode
items.payload.preview
items.payload.count`}</Code>
        <Invariants items={[
          "Linked $files are the first source choice.",
          "Prior Dataset handles become Dataset sources.",
          "Payload arrays or selected Event payloads become row sources.",
          "Context content is never scanned as an implicit source.",
          "The preview is diagnostic; durable records scale independently.",
        ]} />
      </Section>

      <Section title="Nested graph">
        <Graph>{`parent Session
+- dataset Reaction
   |- causes -> selected Event(s)
   |- child Session -> dataset materialization
   +- effect -> context.dataset { datasetId, preview, count }

child Session
|- Dataset domain actions
+- effect -> dataset.materialized`}</Graph>
      </Section>

      <Section title="Typed action input">
        <Code>{`const itemDataset = dataset(itemSchema)

const addItems = defineDomainAction({
  input: z.object({ bidId: z.string(), items: itemDataset }),
  output: z.object({ added: z.number() }),
  execute: importItems,
})

await reaction.given(items).action(addItems, {
  bidId,
  items: items.payload,
})`}</Code>
        <Callout>The action runs only after the referenced Dataset exists, is completed, and has a structurally compatible item schema.</Callout>
      </Section>

      <Section title="Evidence">
        <Evidence ids={["dataset-adapter", "dataset-test", "dataset-action-type", "dataset-action-test"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/children", label: "Child reactions", detail: "Understand the Session boundary used by Dataset." },
        { href: "/reactor/docs/persistence", label: "Persistence graph", detail: "Traverse the parent and child graph." },
      ]} />
    </DocPage>
  )
}

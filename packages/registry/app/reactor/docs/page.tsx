import { Code, DocPage, Evidence, Graph, Invariants, NextLinks, Section } from "./_kit"

export default function ReactorOverviewPage() {
  return (
    <DocPage
      eyebrow="Reaction Engine"
      title="Causal work is Events connected by Reactions."
      lead="A Context stores durable facts about the situation. A Session invokes one typed Reaction definition. Every operation consumes explicit Events and produces another Event."
    >
      <Section title="First complete Reaction">
        <Code>{`import { defineEvent, domain } from "@ekairos/domain"
import { Context } from "@ekairos/context"
import { Events, contextDomain } from "@ekairos/events"
import { ai, defineReaction } from "@ekairos/reactor"
import { z } from "zod"

const support = domain("support")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    received: defineEvent({ payload: z.object({ message: z.string() }) }),
    answered: defineEvent({ payload: z.object({ answer: z.string() }) }),
  })

const answer = defineReaction(
  support.events.received,
  {
    key: "support.answer",
    scope: support,
    engine: ai({ model: "openai/gpt-5.4" }),
    sandbox: false,
  },
  async reaction => {
    const result = await reaction.given(reaction.trigger).agent({
      instruction: "Answer the request precisely.",
      output: z.object({ answer: z.string() }),
    })
    return await reaction.given(result).emit(
      support.events.answered(result.payload),
    )
  },
)

const context = await Context(runtime).create({
  key: "support:42",
  content: { accountId: "42", policyVersion: 3 },
})
const trigger = await Events(runtime).emit(
  support.events.received({ message: "Can I return this?" }),
  { contextId: context.id, channel: "web" },
)
const effect = await context.react(trigger, answer)`}</Code>
      </Section>

      <Section title="One durable graph">
        <Graph>{`Context support:42
+- Session support.answer
   |- trigger -> support.received
   +- root Reaction
      |- agent: support.received -> context.agent
      +- emit: context.agent -> support.answered`}</Graph>
        <Invariants items={[
          "Context content is pure current and previous data.",
          "History enters only through an explicit Events query and given selection.",
          "Every observable operation is a Reaction whose result is an Event.",
          "The final value returned by context.react is a persisted domain Event.",
        ]} />
      </Section>

      <Section title="Evidence">
        <Evidence ids={["reaction-contract", "context-schema", "reaction-graph-test", "public-surface-test"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/events", label: "Domain events", detail: "Define payloads, links, files, metadata, and history." },
        { href: "/reactor/docs/causality", label: "Given and branches", detail: "Build ordered and parallel causal flows." },
      ]} />
    </DocPage>
  )
}

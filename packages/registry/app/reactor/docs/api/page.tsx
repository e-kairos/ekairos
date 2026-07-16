import { Code, DocPage, Evidence, Invariants, NextLinks, Section } from "../_kit"

export default function ApiPage() {
  return (
    <DocPage
      eyebrow="Reaction Engine / API"
      title="The public surface is deliberately small."
      lead="Definitions declare trigger, scope, engine, and sandbox. Handlers select Events with given and produce typed Events through seven operations."
    >
      <Section title="Definition and execution">
        <Code>{`defineReaction(triggerConstructor, {
  key,
  scope,
  engine,
  sandbox,
}, async reaction => effectEvent)

context.react(triggerEvent, definition)
context.react(triggerEvent, definition, { workflow })

reaction.id
reaction.trigger
reaction.context.content
reaction.context.previous
reaction.sandboxId`}</Code>
      </Section>

      <Section title="Given operations">
        <Code>{`reaction.given(event).agent({ instruction, output?, actions?, model?, maxRounds? })
reaction.given(event).action(domainAction, input)
reaction.given(event).dataset({ instruction, schema })
reaction.given(event).workspace({ files, directory?, conflict? })
reaction.given(event).shell({ command, args?, cwd?, env?, timeoutMs? })
reaction.given(event).git({ operation: "clone" | "commit" | "push", ... })
reaction.given(event).emit(domainEventDraft)

reaction.given([firstEvent, secondEvent]).agent({ instruction })`}</Code>
        <Invariants items={[
          "Every operation returns Promise<ContextEvent<Payload>>.",
          "The typed operation result is Event.payload.",
          "The handler returns one Event or an Event array.",
          "Nested execution uses reaction.react with a persisted trigger Event.",
        ]} />
      </Section>

      <Section title="Package boundaries">
        <Code>{`@ekairos/domain   // domain, defineEvent, defineDomainAction, runtime
@ekairos/events   // contextDomain, Events, ContextHandle, Part, React hook
@ekairos/context  // Context(runtime) and ReactionContextHandle
@ekairos/reactor  // defineReaction, ai, Workflow helpers
@ekairos/dataset  // dataset(schema), datasetDomain, runtime adapter`}</Code>
      </Section>

      <Section title="Evidence">
        <Evidence ids={["reaction-contract", "public-surface-test", "type-contract", "runtime-boundary-test"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/testing", label: "Testing", detail: "Run the contract and integration suites." },
        { href: "/reactor/docs", label: "Overview", detail: "Start from a complete working example." },
      ]} />
    </DocPage>
  )
}

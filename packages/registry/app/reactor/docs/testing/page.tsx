import { Callout, Code, DocPage, Evidence, Invariants, NextLinks, Section } from "../_kit"

export default function TestingPage() {
  return (
    <DocPage
      eyebrow="Reaction Engine / Testing"
      title="Test the contract, graph, providers, and Workflow boundary."
      lead="Fast type and unit tests protect the public DX. Temporary InstantDB apps prove causal links. Real-provider tests prove action execution and file-backed behavior. Workflow smoke proves durable replay."
    >
      <Section title="Fast loop">
        <Code title="PowerShell">{`pnpm --filter @ekairos/events typecheck
pnpm --filter @ekairos/events typecheck:tests
pnpm --filter @ekairos/reactor typecheck
pnpm --filter @ekairos/reactor typecheck:tests
pnpm --filter @ekairos/reactor test
pnpm --filter @ekairos/dataset typecheck:tests`}</Code>
        <Invariants items={[
          "Type tests reject removed methods and arbitrary callback actions.",
          "Unit tests verify definition, engine, sandbox, and scope errors.",
          "Model-view tests assert Context, Event, Part, and instruction order.",
        ]} />
      </Section>

      <Section title="Temporary InstantDB">
        <Code>{`$env:INSTANT_PERSONAL_ACCESS_TOKEN = "..."

pnpm --filter @ekairos/events test
pnpm --filter @ekairos/context test
pnpm --filter @ekairos/reactor test
pnpm --filter @ekairos/dataset test
pnpm --filter @ekairos/evals test`}</Code>
        <p>Integration suites provision isolated apps, execute the real graph, verify links and Parts, and destroy the app unless persistence is requested.</p>
      </Section>

      <Section title="Real model and transport">
        <Code>{`pnpm --filter @ekairos/channel test
pnpm --filter @ekairos/documents test
pnpm --filter @ekairos/events-workflow-smoke test:e2e:context-engine`}</Code>
        <Callout warning>Credential-dependent cases skip when their explicit environment is absent. Reports must state whether a real provider ran.</Callout>
      </Section>

      <Section title="Evidence">
        <Evidence ids={["type-contract", "reaction-definition-test", "reaction-graph-test", "dataset-test", "workflow-smoke"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/api", label: "API reference", detail: "Audit the exact package contract." },
        { href: "/reactor/docs", label: "Overview", detail: "Return to the minimal complete Reaction." },
      ]} />
    </DocPage>
  )
}

import { Callout, Code, DocPage, Evidence, Invariants, NextLinks, Section } from "../_kit"

export default function WorkspacePage() {
  return (
    <DocPage
      eyebrow="Reaction Engine / Workspace"
      title="Files, shell, and git are explicit sandbox operations."
      lead="A Reaction stores only a durable sandbox id. Each operation reopens that sandbox, performs one bounded action, and persists a summary Event before releasing the live provider handle."
    >
      <Section title="Materialize Event-linked files">
        <Code>{`const files = await reaction.given(reaction.trigger).workspace({
  files: reaction.trigger.links.files ?? [],
  directory: "inbound",
  conflict: "verify",
})

files.payload.files // created, reused, or replaced`}</Code>
        <Callout><code>verify</code> reuses identical content and rejects divergent content. Replacement is always explicit.</Callout>
      </Section>

      <Section title="Repository and command flow">
        <Code>{`const repository = await reaction.given(files).git({
  operation: "clone",
  url: repositoryUrl,
  target: "repository",
  ref: "main",
})

const tests = await reaction.given(repository).shell({
  command: "pnpm",
  args: ["test"],
  cwd: repository.payload.path,
})

const commit = await reaction.given(tests).git({
  operation: "commit",
  repository: repository.payload.path,
  message: "Implement validated change",
  all: true,
})`}</Code>
        <Invariants items={[
          "The Reaction definition declares the sandbox id or resolver.",
          "A missing sandbox fails before the operation opens.",
          "Shell output records command, cwd, exit code, stdout, and stderr.",
          "Git clone, commit, and push return typed Events.",
        ]} />
      </Section>

      <Section title="Evidence">
        <Evidence ids={["operation-runtime", "runtime-boundary-test", "lab-reaction"]} />
      </Section>
      <NextLinks links={[
        { href: "/reactor/docs/dataset", label: "Dataset", detail: "Use the same sandbox boundary for formal data." },
        { href: "/reactor/docs/examples", label: "Complete examples", detail: "See a repository workflow end to end." },
      ]} />
    </DocPage>
  )
}

export const reactorDocsNav = [
  {
    section: "Start",
    links: [
      { href: "/reactor/docs", label: "Overview" },
      { href: "/reactor/docs/events", label: "Domain events" },
      { href: "/reactor/docs/causality", label: "Given and branches" },
    ],
  },
  {
    section: "Operations",
    links: [
      { href: "/reactor/docs/agent", label: "Agent and actions" },
      { href: "/reactor/docs/workspace", label: "Workspace, shell, git" },
      { href: "/reactor/docs/dataset", label: "Dataset" },
    ],
  },
  {
    section: "Composition",
    links: [
      { href: "/reactor/docs/children", label: "Child reactions" },
      { href: "/reactor/docs/persistence", label: "Persistence graph" },
      { href: "/reactor/docs/observability", label: "Event parts and UI" },
    ],
  },
  {
    section: "Apply",
    links: [
      { href: "/reactor/docs/examples", label: "Complete examples" },
      { href: "/reactor/docs/testing", label: "Testing" },
      { href: "/reactor/docs/api", label: "API reference" },
    ],
  },
] as const

export type ReactorEvidence = {
  label: string
  path: string
  start?: number
  end?: number
  kind: "source" | "test"
}

export const reactorEvidence = {
  "reaction-contract": {
    label: "Reaction definition and operation contract",
    path: "packages/reactor/src/reaction.ts",
    kind: "source",
  },
  "reaction-definition-test": {
    label: "Reaction definition invariant tests",
    path: "packages/reactor/src/tests/reaction-definition.test.ts",
    kind: "test",
  },
  "reaction-graph-test": {
    label: "Fan-out, fan-in, actions, Dataset, and effects",
    path: "packages/reactor/src/tests/reaction.events.instant.test.ts",
    kind: "test",
  },
  "public-surface-test": {
    label: "Breaking public surface test",
    path: "packages/reactor/src/tests/public-surface.test.ts",
    kind: "test",
  },
  "runtime-boundary-test": {
    label: "Engine, sandbox, scope, and return boundaries",
    path: "packages/reactor/src/tests/runtime-boundaries.test.ts",
    kind: "test",
  },
  "operation-runtime": {
    label: "Event-producing operation dispatcher",
    path: "packages/reactor/src/reaction.operation.ts",
    kind: "source",
  },
  "agent-runtime": {
    label: "Agent loop and scoped action execution",
    path: "packages/reactor/src/agent.ts",
    kind: "source",
  },
  "reaction-view": {
    label: "Provider-neutral model projection",
    path: "packages/reactor/src/reaction-view.ts",
    kind: "source",
  },
  "reaction-view-test": {
    label: "Context, Event, Part, and instruction message order",
    path: "packages/reactor/src/tests/reaction-view.events.test.ts",
    kind: "test",
  },
  "context-schema": {
    label: "Five-entity Context schema",
    path: "packages/events/src/schema.ts",
    kind: "source",
  },
  "context-store": {
    label: "Context persistence contract",
    path: "packages/events/src/context.store.ts",
    kind: "source",
  },
  "instant-store": {
    label: "InstantDB Context graph store",
    path: "packages/events/src/stores/instant.store.ts",
    kind: "source",
  },
  "event-builder": {
    label: "Event create, emit, query, and Part builder",
    path: "packages/events/src/event.builder.ts",
    kind: "source",
  },
  "event-query-test": {
    label: "Explicit Event history query test",
    path: "packages/events/src/tests/events.query.instant.test.ts",
    kind: "test",
  },
  "event-persistence-test": {
    label: "Context graph persistence integration test",
    path: "packages/events/src/tests/context.persistence.instant.test.ts",
    kind: "test",
  },
  "context-runtime": {
    label: "Application-facing Context boundary",
    path: "packages/context/src/index.ts",
    kind: "source",
  },
  "context-reaction-test": {
    label: "Context Reaction and child Session integration test",
    path: "packages/context/src/tests/context-reaction.instant.test.ts",
    kind: "test",
  },
  "stream-hook": {
    label: "Reactive Context, Session, Reaction, Event, and Part hook",
    path: "packages/events/src/react.use-context.ts",
    kind: "source",
  },
  "dataset-adapter": {
    label: "Reaction Dataset adapter",
    path: "packages/dataset/src/reactionDataset.ts",
    kind: "source",
  },
  "dataset-test": {
    label: "Real Dataset child Session integration test",
    path: "packages/dataset/src/tests/reaction.dataset.instant.test.ts",
    kind: "test",
  },
  "dataset-action-type": {
    label: "Formal Dataset action-input type",
    path: "packages/dataset/src/datasetType.ts",
    kind: "source",
  },
  "dataset-action-test": {
    label: "Dataset action-input schema validation",
    path: "packages/dataset/src/tests/dataset.action-input.instant.test.ts",
    kind: "test",
  },
  "channel-reaction-test": {
    label: "Real inbound channel to Reaction test",
    path: "packages/channel/src/tests/channel.reaction.e2e.instant.test.ts",
    kind: "test",
  },
  "eval-runtime": {
    label: "Session-aware evaluation runtime",
    path: "packages/evals/src/evals.ts",
    kind: "source",
  },
  "lab-reaction": {
    label: "Repository coding Reaction",
    path: "packages/lab/src/index.ts",
    kind: "source",
  },
  "workflow-smoke": {
    label: "Durable Workflow Session smoke",
    path: "packages/events/tests/playwright/server/tests/_story-smoke.ts",
    kind: "test",
  },
  "type-contract": {
    label: "Compile-time Reaction contract",
    path: "packages/reactor/src/__type_tests__/reaction.typecheck.ts",
    kind: "test",
  },
} as const satisfies Record<string, ReactorEvidence>

export type ReactorEvidenceId = keyof typeof reactorEvidence

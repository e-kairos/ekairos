export type DomainRegistryComponentStatus = "published";

export type DomainRegistryComponentLink = {
  id: string;
  label: string;
  description: string;
  href: string;
  registryName: string;
  registryPath: string;
  target: string;
  dependency: string;
  packageImport: string;
  status: DomainRegistryComponentStatus;
  kind: "component";
};

export type DomainRegistryDemoLink = {
  label: string;
  href: string;
  description: string;
};

export type DomainRegistrySchemaEntity = {
  name: string;
  description: string;
};

export type DomainRegistryAction = {
  name: string;
  description: string;
};

export type DomainRegistryRoute = {
  href: string;
  label: string;
  description: string;
};

export type DomainRegistryEntry = {
  id: string;
  title: string;
  summary: string;
  href: string;
  componentsHref: string;
  domainHref: string;
  schemaPackage: string;
  packageDependency: string;
  aggregateRoot: string;
  durableSurface: string;
  heroLabel: string;
  heroTitle: string;
  heroBody: string;
  schemaEntities: DomainRegistrySchemaEntity[];
  actions: DomainRegistryAction[];
  usageTitle: string;
  usageBody: string;
  usageCode: string;
  componentSurface: string;
  componentBacklog: string[];
  routes: DomainRegistryRoute[];
  components: DomainRegistryComponentLink[];
  demos: DomainRegistryDemoLink[];
};

const domainRoutes = (id: string): DomainRegistryRoute[] => [
  {
    href: `/${id}`,
    label: `/${id}`,
    description: "Landing secundaria del dominio: posicionamiento, loop de uso y punto de entrada.",
  },
  {
    href: `/${id}/components`,
    label: `/${id}/components`,
    description: "UI instalable y primitivas visuales que pueden llegar a Workbench y templates.",
  },
  {
    href: `/${id}/domain`,
    label: `/${id}/domain`,
    description: "Libreria del dominio: schema, actions, runtime y forma de uso.",
  },
];

export const eventsDomainEntry: DomainRegistryEntry = {
  id: "events",
  title: "Events",
  summary:
    "Context-first runtime for AI product interactions: contexts, turns, executions, steps, parts, and durable replay.",
  href: "/events",
  componentsHref: "/events/components",
  domainHref: "/events/domain",
  schemaPackage: "@ekairos/events",
  packageDependency: "@ekairos/events@beta",
  aggregateRoot: "event_contexts",
  durableSurface: "event_parts",
  heroLabel: "Context runtime",
  heroTitle: "The interaction layer for AI workflows.",
  heroBody:
    "Events owns the durable conversation and execution trail. UI components render that surface, while the package keeps context state, model reactions, tools, and replay out of the registry.",
  schemaEntities: [
    {
      name: "event_contexts",
      description: "The aggregate root for a durable AI interaction, addressed by id or key.",
    },
    {
      name: "event_items",
      description: "Stored user, assistant, and tool items that make up the turn history.",
    },
    {
      name: "event_executions",
      description: "Reaction runs attached to a context, including status and runtime metadata.",
    },
    {
      name: "event_steps",
      description: "Execution-level steps for reasoning, action calls, and observable progress.",
    },
    {
      name: "event_parts",
      description: "Canonical output and replay surface for text, tools, data, and streamed chunks.",
    },
  ],
  actions: [
    {
      name: "createContext",
      description: "Builds a registered context with narrative, skills, actions, model, and reactor.",
    },
    {
      name: "defineAction",
      description: "Declares typed domain tools that a context reaction can call.",
    },
    {
      name: "createAiSdkReactor",
      description: "Adapts AI SDK model/tool output into canonical event items and parts.",
    },
    {
      name: "runContextReactionDirect",
      description: "Executes a context reaction without registry-specific UI glue.",
    },
    {
      name: "useContext",
      description: "React hook from @ekairos/events/react for reading and appending context items.",
    },
  ],
  usageTitle: "Register a context. Render it with package state.",
  usageBody:
    "Product code defines the context once and registry UI imports the package hook directly. The component stays presentation-focused.",
  usageCode: `import { createContext } from "@ekairos/events";
import { useContext } from "@ekairos/events/react";

export const tenderContext = createContext("tender.response")
  .context(async (stored) => ({
    tenderId: stored.content?.tenderId,
    orgId: stored.content?.orgId,
  }))
  .narrative(async ({ content }) =>
    \`Prepare the supplier response for tender \${content.tenderId}.\`,
  )
  .actions(async () => ({
    // domain actions live here
  }))
  .model("gpt-4o-mini")
  .build();

export function TenderAgent({ db, contextKey }) {
  const context = useContext(db, { key: contextKey });
  return <EventContextPanel context={context} />;
}`,
  componentSurface:
    "Events is the first published UI surface because product apps already need to render live context state, prompt input, history, and execution progress.",
  componentBacklog: [
    "ContextAgent as the full app-facing shell",
    "Prompt primitives shared with Workbench domain routes",
    "Event step renderers for tool output and terminal-like progress",
  ],
  routes: domainRoutes("events"),
  components: [
    {
      id: "event-context-panel",
      label: "EventContextPanel",
      description:
        "Interactive panel for rendering an event context timeline and appending input through the canonical events React API.",
      href: "/events/components#event-context-panel",
      registryName: "event-context-panel",
      registryPath: "/r/event-context-panel.json",
      target: "components/ekairos/events/event-context-panel.tsx",
      dependency: "@ekairos/events@beta",
      packageImport: "@ekairos/events/react",
      status: "published",
      kind: "component",
    },
  ],
  demos: [],
};

export const sandboxDomainEntry: DomainRegistryEntry = {
  id: "sandbox",
  title: "Sandbox",
  summary:
    "Provider-agnostic execution environments for commands, files, process streams, ports, checkpoints, and coding agents.",
  href: "/sandbox",
  componentsHref: "/sandbox/components",
  domainHref: "/sandbox/domain",
  schemaPackage: "@ekairos/sandbox",
  packageDependency: "@ekairos/sandbox@beta",
  aggregateRoot: "sandbox_sandboxes",
  durableSurface: "sandbox_processes",
  heroLabel: "Execution runtime",
  heroTitle: "Durable sandboxes without provider lock-in.",
  heroBody:
    "Sandbox turns Vercel, Daytona, Sprites, and future providers into a domain surface: create an environment, stream commands, write files, expose ports, and reconnect by durable ids.",
  schemaEntities: [
    {
      name: "sandbox_sandboxes",
      description: "Durable sandbox records with provider, runtime, purpose, external id, and status.",
    },
    {
      name: "sandbox_processes",
      description: "Command/process runs linked to a sandbox and optional stream output.",
    },
  ],
  actions: [
    {
      name: "createSandbox",
      description: "Creates a provider-backed sandbox and persists the durable sandbox id.",
    },
    {
      name: "runCommand",
      description: "Runs a command in an existing sandbox and returns the immediate result.",
    },
    {
      name: "runCommandProcess",
      description: "Runs a command as a durable process with linked stream output.",
    },
    {
      name: "writeFiles / readFile",
      description: "Moves file payloads through the sandbox boundary.",
    },
    {
      name: "createCheckpoint / getPortUrl",
      description: "Captures sandbox state and exposes running app ports.",
    },
  ],
  usageTitle: "Create once. Reconnect by sandbox id.",
  usageBody:
    "Workbench, agents, and templates should treat sandbox ids as durable domain ids, not provider handles.",
  usageCode: `import { sandboxDomain } from "@ekairos/sandbox";

const sandbox = await runtime.use(sandboxDomain);

const created = await sandbox.actions.createSandbox({
  provider: "vercel",
  runtime: "node22",
  purpose: "registry-preview",
});

const run = await sandbox.actions.runCommandProcess({
  sandboxId: created.data.sandboxId,
  command: "sh",
  args: ["-lc", "pnpm test"],
  kind: "command",
  mode: "foreground",
});

const stream = await sandbox.actions.readProcessStream({
  processId: run.data.processId,
});`,
  componentSurface:
    "Sandbox UI should expose environment lifecycle, command streams, files, checkpoints, and preview ports as reusable primitives.",
  componentBacklog: [
    "Sandbox status strip with provider/runtime identity",
    "Process stream panel for stdout, stderr, and exit state",
    "Port preview launcher for generated apps",
  ],
  routes: domainRoutes("sandbox"),
  components: [],
  demos: [],
};

export const datasetDomainEntry: DomainRegistryEntry = {
  id: "dataset",
  title: "Dataset",
  summary:
    "Runtime-first dataset materialization for domain rows, query snapshots, file/text sources, transforms, and sandbox-backed analysis.",
  href: "/dataset",
  componentsHref: "/dataset/components",
  domainHref: "/dataset/domain",
  schemaPackage: "@ekairos/dataset",
  packageDependency: "@ekairos/dataset@beta",
  aggregateRoot: "dataset_datasets",
  durableSurface: "dataset_records",
  heroLabel: "Materialization runtime",
  heroTitle: "Domain data packaged for AI work.",
  heroBody:
    "Dataset converts domain state into durable rows and artifacts. It can snapshot queries directly or use sandbox-backed reactors for files, transforms, instructions, and multi-source work.",
  schemaEntities: [
    {
      name: "dataset_datasets",
      description: "Dataset metadata, source analysis, output mode, sandbox id, and linked data files.",
    },
    {
      name: "dataset_records",
      description: "Materialized rows linked to a dataset and optional source files.",
    },
  ],
  actions: [
    {
      name: "dataset(runtime)",
      description: "Builder entry point for source selection, output mode, sandbox, reactor, and build.",
    },
    {
      name: "fromQuery",
      description: "Snapshots domain query results into a dataset without requiring a reactor.",
    },
    {
      name: "from / fromDataset / fromText",
      description: "Adds file, dataset, and text sources for materialization.",
    },
    {
      name: "asRows / first",
      description: "Controls whether output is row-oriented or a single structured object.",
    },
    {
      name: "materializeDataset",
      description: "Tool-level wrapper for agents that need to produce datasets.",
    },
  ],
  usageTitle: "Materialize a domain query into rows.",
  usageBody:
    "Direct query snapshots stay lightweight; richer parsing and transforms can opt into sandbox/reactor execution.",
  usageCode: `import { dataset } from "@ekairos/dataset";

const result = await dataset(runtime)
  .fromQuery(tenderDomain, {
    query: {
      tenders: {
        $: {
          where: { status: "open" },
          fields: ["title", "deadline", "buyerName"],
          limit: 50,
        },
      },
    },
    title: "open-tenders",
    explanation: "Open tender snapshot for analysis.",
  })
  .build({ datasetId: "open_tenders_v1" });

console.log(result.datasetId);`,
  componentSurface:
    "Dataset UI should make materialization observable: sources, row counts, schema, transform state, and downloadable artifacts.",
  componentBacklog: [
    "Dataset source summary for domain queries and files",
    "Rows/object preview with schema-aware empty states",
    "Transform run panel linked to sandbox and events",
  ],
  routes: domainRoutes("dataset"),
  components: [],
  demos: [],
};

export const tasksDomainEntry: DomainRegistryEntry = {
  id: "task",
  title: "Task",
  summary:
    "Durable tasks with typed outcomes for approvals, reviews, handoffs, and any workflow step that must wait for a decision.",
  href: "/task",
  componentsHref: "/task/components",
  domainHref: "/task/domain",
  schemaPackage: "@ekairos/tasks",
  packageDependency: "@ekairos/tasks@beta",
  aggregateRoot: "task_tasks",
  durableSurface: "outcome",
  heroLabel: "Decision runtime",
  heroTitle: "Typed human work inside AI workflows.",
  heroBody:
    "Tasks keeps the durable state small and strict: open a task, wait for a typed outcome, decide/cancel/fail it, and let product domains own assignment and notification policy.",
  schemaEntities: [
    {
      name: "task_tasks",
      description:
        "Task record with kind, key, state, instructions, context, outcome schema, outcome, error, and timestamps.",
    },
  ],
  actions: [
    {
      name: "openTask",
      description: "Creates or reuses a durable task, usually idempotent by key.",
    },
    {
      name: "getTask",
      description: "Reads the current task state and stored outcome metadata.",
    },
    {
      name: "awaitOutcome",
      description: "Waits until a task has a typed outcome or reaches a terminal state.",
    },
    {
      name: "decideTask",
      description: "Stores a typed outcome and closes the task.",
    },
    {
      name: "cancelTask / failTask",
      description: "Closes the task without a successful domain outcome.",
    },
  ],
  usageTitle: "Open a typed review task.",
  usageBody:
    "The task package owns state and outcome validation. Assignment, approvers, notifications, and product links stay in the app/domain layer.",
  usageCode: `import { Task } from "@ekairos/tasks";
import { z } from "zod";

const reviewOutcome = z.object({
  accepted: z.boolean(),
  comment: z.string().optional(),
});

const task = await Task.open(runtime, {
  kind: "review",
  key: "review:execution_1:step_1",
  outcome: reviewOutcome,
  instructions: "Review the generated supplier response.",
  context: { executionId: "execution_1" },
  outcomeKind: "review",
});

const outcome = await task.outcome();`,
  componentSurface:
    "Tasks UI should expose pending decisions, typed outcome controls, task state, and the domain context needed to decide.",
  componentBacklog: [
    "Task decision panel generated from outcome schema",
    "Task queue item for Workbench and product inboxes",
    "Outcome timeline linked back to Events executions",
  ],
  routes: domainRoutes("task"),
  components: [],
  demos: [],
};

export const domainRegistry = [
  eventsDomainEntry,
  sandboxDomainEntry,
  datasetDomainEntry,
  tasksDomainEntry,
] as const satisfies DomainRegistryEntry[];

export function getDomainById(id: string) {
  return domainRegistry.find((domain) => domain.id === id) ?? null;
}

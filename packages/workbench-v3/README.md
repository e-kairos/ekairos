# Ekairos Workbench v3

Live React workbench for the Context / Session / Reaction / Event graph.

It provisions a temporary InstantDB app and a durable Daytona Sandbox, invokes
Azure OpenAI through the real Reactor, and renders both durable Event Parts and
the provisional Reaction stream consumed by `@ekairos/events/react`.

The left column shows the Context, Sessions, and durable Events. The center
column uses the Event-shaped projection returned by `useContext`. The right
column renders the causal DAG and a Gantt projection. It exposes the selected
Reaction's complete ordered chunk journal on demand; active Reactions always
stream immediately, while historical streams are not replayed until selected.

## Durable boundary

The HTTP route persists the trigger and starts the Workflow, then returns `202`.
It does not wait for model, Dataset, Sandbox, or Git work.

```ts
export async function answerMessageWorkflow(input: PreparedWorkbenchReaction) {
  "use workflow"

  const answered = await input.context.react(input.trigger, definition)
  return answered
}
```

`context.react(...)` executes in the caller's boundary. The same call is direct
when used from a normal async function and durable when its caller has the
`"use workflow"` directive. Reactor never creates a Workflow implicitly.

The persisted correspondence is:

- one Context Session is the complete Reaction-definition invocation and stores
  the Workflow run id when one exists
- the root Reaction spans the Session
- every semantic operation (`agent`, `dataset`, `action`, `loadFiles`,
  `storeFiles`, `shell`, `git`, `emit`) is a Reaction and, at the top Workflow
  level, one durable step
- child Sessions and their Reactions remain nested in the causal graph

`startReaction`, `finishReaction`, and failure handling are technical durable
checkpoints. The Gantt hides them and renders the Workflow span plus semantic
Reactions, including parallel overlap.

The browser does not poll Workflow state. `useContext` subscribes directly to
Context, Session, Reaction, Event, and Event Part entities in InstantDB, then
reads linked `$streams` for active or selected streaming Reactions.

The default `Causal review` scenario proves the full path:

1. Git clone and event-file materialization execute in parallel.
2. Dataset materialization and structured analysis execute in parallel.
3. A repository-aware decision Reaction joins those effect Events.
4. Shell writes the report, `storeFiles` publishes it, and Git commits it.
5. `workbench.recordReview` validates `dataset(workbenchItemSchema)`, writes the
   linked durable review, resolves its Context from the sole `reactionId`, and
   starts the verification child Reaction.
6. `workbench.reviewCompleted` links the review and artifact as the final domain
   Event; Dataset materialization and verification remain visible as child
   Sessions.

At the beginning of a causal review, the Reaction sandbox resolver probes the
cached Daytona lease. A missing remote sandbox is replaced once under a shared
lock without replacing the InstantDB app, Context, or conversation history.
Provider, network, and credential failures remain visible instead of triggering
an unrelated replacement.

Required environment variables:

- `INSTANT_PERSONAL_ACCESS_TOKEN`
- `AZURE_API_KEY`
- `AZURE_RESOURCE_NAME` (or `AZURE_OPENAI_ENDPOINT`)
- `DAYTONA_API_KEY`
- optional `DAYTONA_API_URL`, `AZURE_API_VERSION`, and
  `WORKBENCH_AZURE_MODEL` (defaults to `gpt-5.6-sol`)

```bash
pnpm --filter ekairos-workbench-v3 dev
```

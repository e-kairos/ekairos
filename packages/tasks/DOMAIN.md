# Tasks Domain

`@ekairos/tasks` models durable work units with typed outcomes.

A task is opened with a stable `key`, human-readable `instructions`, a `context`
payload, and a stored JSON schema for the only valid final outcome. Workflows,
CLIs, UIs, and agents may all operate the same task through the domain actions.

## Entities

- `task_tasks`: the task record. It owns state, instructions, context, outcome
  schema, final outcome, run lock metadata, and progress.

## Relationships

- `task_tasks.children` / `task_tasks.parent`: hierarchical work. A parent task
  cannot be completed while any child task remains open or in progress.
- `task_tasks.dependsOn` / `task_tasks.dependents`: dependency graph metadata for
  orchestration and UI. Dependency policy is enforced by the workflow that owns
  the process.

## States

- `open`: available for a human, process, or workflow runner to start or complete.
- `in_progress`: locked by an active run. Only that run may complete, cancel,
  or fail it.
- `completed`: terminal with a valid typed outcome.
- `cancelled`: terminal without a valid business outcome.
- `failed`: terminal due to technical or business execution failure.

## Invariants

- `key` is unique and is the idempotency handle for opening tasks.
- Every task stores exactly one outcome schema.
- Final outcomes must validate against the stored schema.
- A task in progress must be mutated with the matching `runId`.
- A started task must finish with `completed`, `cancelled`, `failed`, or
  a still-pending child task that the workflow explicitly awaits. Silently
  ending a run is a failure.
- A parent task cannot complete until all children are terminal.

## Workflow Semantics

`Task.start` marks a task as `in_progress`, runs user code, and fails the task if
the callback throws or ends without a terminal transition. If a task needs
external intervention, the workflow opens a child task and awaits that child's
typed outcome before completing the parent. `Task.outcome()` first reads durable
state and only waits on a workflow hook when no terminal outcome is stored yet,
so completing a task from another process is safe even when no worker is
currently waiting.

# Dataset Domain

Module: `@ekairos/dataset`

Schema domain: `datasetSchemaDomain`

Full server domain: `datasetDomain`

## Ownership

- `dataset_datasets`: durable identity, status, item schema, notation, and count
- `dataset_records`: ordered durable records
- Dataset links to its data `$file` and source Context
- `materializationRequested` and `materialized` Events
- registered actions used by the materialization Reaction

## Invariants

1. Every Dataset has an explicit source derived from selected Events.
2. File content remains in `$files` until materialization copies it into a
   sandbox workspace.
3. Dataset identity is stable and unique by `datasetId`.
4. Records are ordered and validated against the Dataset item schema.
5. Model-driven materialization runs in a child Session linked to the parent
   Dataset operation.
6. `dataset(schema)` is a formal domain-action input type. Before an action
   executes, the referenced Dataset must exist, be completed, and have a
   structurally compatible item schema.
7. Applications compose `datasetSchemaDomain` into their root schema. This
   client-safe entrypoint never imports Dataset actions, sandbox providers, or
   filesystem code.
8. `datasetDomain` adds the server actions used by Dataset materialization.
   Applications expose those actions from the root only when they are part of
   the application's public write contract.
9. A deterministic Dataset id is an idempotency boundary. Reopening a completed
   Dataset returns `mode: "opened"` and its existing reader; it never rebuilds
   the same source/schema materialization.
10. Dataset readers page ordered rows by cursor. Agent adapters may apply a
    compact top-level equality filter while advancing that source cursor, so
    filtered reads remain deterministic and resumable.
11. Preview rows are affordances, not evidence completeness. Consumers that
    make factual claims over a Dataset must read the necessary rows through its
    reader.

The application-facing materialization API is
`reaction.given(event).dataset({ instruction, schema })`.

When `runtime.materializeDataset` is configured, `reaction.agent(...)` also
receives the scoped `dataset.materialize` capability by default. Its query
source is validated against the Reaction domain before execution.

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
`session.from(event).dataset({ instruction, schema })`.

When `runtime.materializeDataset` is configured, `reaction.agent(...)` also
receives the scoped `dataset.materialize` capability by default. Its query
source is validated against the Reaction domain before execution.

## Stores

The default Reaction Dataset store is Instant. Calling
`buildReactionDataset(input)` without a second argument preserves that path.

A runtime may opt into the remote endpoint store with
`buildReactionDataset(input, { store, scope: { app, env } })`. The store
materializes addressable row datasets and exposes row reads and aggregations.
Its scope is always explicit:

- `app` identifies the registered application.
- `env` identifies the application environment.
- `organizationId`, when configured on the store, is sent as request scope.

InstaQL is never represented as remote pushdown. The active runtime executes
the query and the resulting rows are sent as
`source: { kind: "rows", rows }`. Local file, prior-Dataset, instructed, and
model-driven transforms continue to use Instant as staging; only their final
rows are materialized in the remote store.

The endpoint accepts at most 10,000 rows in one inline materialization. The
adapter fails with `remote_dataset_inline_rows_limit_exceeded:<actual>>10000`
when a direct or locally transformed result exceeds that boundary. It never
silently truncates the result.

The remote materialization contract currently generates the final `datasetId`
and does not accept a client idempotency key. Therefore a retry after an
ambiguous successful create can produce another remote Dataset. This is an
explicit platform-contract gap, not something this package works around. A
candidate platform fix is to accept a client-provided key and upsert
idempotently.

# Dataset Domain

Module: `@ekairos/dataset`

Canonical domain: `datasetDomain`

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
7. Applications explicitly expose `datasetDomain.actions` from the root domain.

The application-facing materialization API is
`reaction.given(event).dataset({ instruction, schema })`.

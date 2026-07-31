# Dataset Internals

The public Reaction operation delegates to `buildReactionDataset` through the
runtime's `materializeDataset` integration.

Materialization proceeds as follows:

1. derive an explicit source from the causal Events selected by `from(...)`
2. create or load the deterministic Dataset identity
3. create a pure source Context containing descriptors
4. start a child Session for model-driven materialization
5. copy linked files to the configured sandbox only when required
6. execute registered Dataset actions
7. validate and persist ordered records and the data file
8. emit `dataset.materialized`
9. return a small typed handle to the parent Dataset operation Event

Direct query snapshots may avoid a model and sandbox. File parsing,
transformations, and multi-source work require explicitly configured engine and
sandbox capabilities.

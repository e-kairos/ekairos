*** Begin ECU Change
Key: reactor-domain-events
Title: Typed domain events and causal Reaction Engine
Purpose: Replace the legacy Context execution stack with a domain-first causal runtime whose events, reactions, model work, actions, files, sandboxes, datasets, and UI projections remain typed, durable, and reviewable.

*** Begin Context
This is the final breaking architecture, reconstructed from the verified repository state rather than from intermediate iterations.

Review order:
1. Domain contracts define scoped actions and the durable Context schema.
2. Events, Context, Channel, and Agent establish immutable facts, explicit file projection, and pure application context.
3. Reactor and provider engines execute causally linked operations as Sessions, Reactions, Events, and Event Parts.
4. Dataset, Sandbox, Documents, and adjacent domains provide durable typed capabilities without the removed Structure package.
5. CLI and React adapters project the same runtime into workflow, streaming, documentation, and review surfaces.
6. Workspace and release gates encode the package graph and executable verification contract.

Invariants:
- Breaking-only migration: no compatibility layer for defineReactor, Moment, resources, legacy steps, or Structure.
- Context owns current and previous application data; history is queried explicitly.
- A Session contains Reactions; each Reaction links cause Events to effect Events.
- Every observable operation returns an Event and streams through Event Parts.
- Files remain typed links until explicit projection or workspace materialization.
- Domain writes execute only through scoped registered actions.
- Dataset materialization is a nested causal execution and dataset(type) validates durable action inputs before implementation code runs.
- Durable sandbox access is idempotent by sandbox id; provider handles are never hidden process state.

Verification completed before publication:
- Recursive package and test typechecks.
- Domain, Events, Reactor Workflow, Dataset Workflow, Sandbox, Documents, Channel, Tasks, Evals, Lab, and provider test suites.
- Real Next.js + Workflow + InstantDB Playwright scenarios.
- Publish-package and adjacent package builds.
*** End Context
*** End ECU Change

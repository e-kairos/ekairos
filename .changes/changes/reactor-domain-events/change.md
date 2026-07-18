*** Begin ECU Change
Key: reactor-domain-events
Title: Typed domain events and causal Reaction Engine
Purpose: Replace the legacy Context execution stack with a domain-first causal runtime whose events, reactions, model work, actions, files, sandboxes, datasets, streaming, and UI projections remain typed, durable, and reviewable.

*** Begin Context
This is the final breaking architecture, reconstructed from the verified repository state rather than from intermediate iterations.

Review order:
1. Domain contracts define scoped actions and the durable Context schema.
2. Events, Context, Channel, and Agent establish immutable facts, explicit file projection, and pure application context.
3. Reactor and provider engines execute causally linked operations as Sessions, Reactions, Events, and Event Parts.
4. Dataset, Sandbox, Documents, and adjacent domains provide durable typed capabilities without the removed Structure package.
5. CLI and React adapters project the same runtime into workflow, streaming, documentation, and review surfaces.
6. Workspace and release gates encode the package graph and executable verification contract.
7. Reaction streaming uses a zero-or-one InstantDB stream per Reaction as a provisional resumable journal, then consolidates the reserved effect id into immutable Event Parts.
8. Workbench v3 proves the complete path with the Esolbay Azure `gpt-5.6-sol` deployment, a real Daytona sandbox, nested Dataset materialization, parallel analysis, typed actions, fan-in, semantic event publication, and on-demand stream traces.

Invariants:
- Breaking-only migration: no compatibility layer for defineReactor, Moment, resources, legacy steps, or Structure.
- Context owns current and previous application data; history is queried explicitly.
- A Session contains Reactions; each Reaction links cause Events to effect Events.
- A Reaction owns zero or one provisional stream; non-streaming operations create none.
- Each event-scoped stream entry uses the same reserved effect id as its durable Event, so clients replace rather than duplicate every provisional projection independently.
- One `agent` operation remains one Reaction while every model round and executed action becomes an ordered durable effect Event of that Reaction.
- Event Parts are the immutable canonical result after stream consolidation.
- Files remain typed links until explicit projection or workspace materialization.
- Domain writes execute only through scoped registered actions.
- Dataset materialization is a nested causal execution and dataset(type) validates durable action inputs before implementation code runs.
- Durable sandbox access is idempotent by sandbox id; provider handles are never hidden process state.

Verification completed for this iteration:
- Domain, Events, and Reactor production builds plus the Workbench v3 typecheck.
- Focused causal suites: 27/27 tests across Domain execution identity, Event stream projection, Reactor multi-effect/nesting/causality, and Workbench graph/lifecycle behavior.
- Events 22/22 and Reactor 15/15 tests, including temporary InstantDB apps and the complete causal Dataset/action/event graph.
- Sandbox runtime adapter 2/2 tests and production package build.
- Workbench v3 7/7 tests, typecheck, and production Next.js build.
- Real Azure `gpt-5.6-sol` run completed in 140.3 seconds with a real Daytona sandbox, a three-row durable Dataset, three parallel branches, fan-in decision, typed domain action, final `workbench.reviewCompleted` Event, and nested Dataset Session.
- Missing/terminal Daytona lease renewal verified through focused tests for provider `not found`, durable `sandbox_not_found`, durable `sandbox_not_active:shutdown`, non-terminal status propagation, and credential failure propagation.
- Real Workbench review POST completed HTTP 200 in 198.32 seconds using the Esolbay `gpt-5.6-sol` env, after exercising the real sandbox + Dataset path.
- Browser reload verified historical stream hydration on demand while running Reactions remain live, avoiding eager replay of every provider chunk.
- A final browser-driven `gpt-5.6-sol` run reached `idle` with 18 Reactions and 32 effects, including parallel clone/load, Dataset materialization, six scoped action calls, shell/files/git, a domain action, and a nested verification Session.
- Conversation renders one user turn plus one assistant Reaction, orders parallel and nested stages, and selecting the nested `reviewVerificationCompleted` effect opens its own `emit` trace instead of the parent agent.
*** End Context
*** End ECU Change

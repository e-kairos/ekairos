# Reactor Boundary

Module: `@ekairos/reactor`

Reactor orchestrates `contextDomain`; it owns no InstantDB schema.

## Concepts

- Reaction definition: typed trigger, domain scope, engine, sandbox, handler
- Session: one invocation of that definition in one Context
- Reaction: one causal operation from cause Events to effect Events
- Agent: the only model-backed primitive
- Effect: any Event produced by an operation

## Invariants

1. `defineReaction` declares one trigger Event constructor and one domain scope.
2. Engine and sandbox are mandatory declarations; `false` disables them.
3. `reaction.trigger` is the persisted typed trigger Event.
4. `reaction.given(event)` selects one Event or an ordered Event array.
5. Every operation returns a persisted Event with `.payload`.
6. Domain actions and emitted Event drafts must belong to the declared scope.
7. Fan-out starts operations from the same Event. Fan-in passes their Events as
   one array to `given`.
8. A nested Reaction has its own child Session and explicit parent relation.
9. Direct and Workflow execution use the same graph and idempotent operation
   ids.
10. Workflow ownership is explicit: `context.react(...)` runs inside the
    caller's boundary and never starts or waits for a Workflow.
11. If the runtime provides Dataset materialization, Agent receives one scoped
    Dataset capability by default. Every query is constrained to the Reaction
    domain and every materialization remains observable in the causal graph.
12. Agent output schemas are provider-agnostic. The engine owns any model-tool
    wire envelope and persists only the parsed domain value.
13. Structured Agent output is validated at the shared engine boundary. A
    bounded repair budget (two retries by default) returns the formatted Zod
    failure, expected JSON Schema, and prior response to any engine before the
    operation fails. Empty/malformed responses use the same budget.
14. Dataset tools never ask a model to reconstruct causal source identity.
    `dataset.materialize` defaults to the Events selected by `given(...)`;
    `dataset.read` is the row-evidence boundary and every read remains visible
    as an Agent action in the causal graph.
15. Dataset previews in Agent prompts are discovery metadata only. The prompt
    indexes available Dataset key, title, row count, and a compact preview, but
    factual claims must be grounded in rows returned by `dataset.read`.

Cross-package execution hooks are private under `@ekairos/reactor/internal`.

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

Cross-package execution hooks are private under `@ekairos/reactor/internal`.

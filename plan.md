# Reaction Architecture Implementation

## Decision

The durable execution graph is reduced to five Context entities:

```text
context_contexts
  context_sessions
    context_reactions
      causes  -> context_events
      effects -> context_events
                    context_eventParts
```

`Session` replaces execution as the invocation boundary. `Reaction` is the
causal relation from Events to Events. Every observable operation returns an
Event. Steps, Points, joins, and separate execution-item models are removed.

## Public DX

```ts
const definition = defineReaction(
  requisition.events.messageReceived,
  {
    key: "requisition.answer",
    scope: requisition,
    engine: ai({ model: "openai/gpt-5.4" }),
    sandbox: sandboxId,
  },
  async reaction => {
    const [items, risks] = await Promise.all([
      reaction.given(reaction.trigger).dataset({
        instruction: "Extract requested items.",
        schema: itemSchema,
      }),
      reaction.given(reaction.trigger).agent({
        instruction: "Assess commercial risks.",
        output: riskSchema,
      }),
    ])

    const decision = await reaction.given([items, risks]).agent({
      instruction: "Decide from the extracted facts.",
      output: decisionSchema,
      actions: [requisition.actions.recordDecision.scope({ requisitionId })],
    })

    return await reaction.given(decision).emit(
      requisition.events.answered(decision.payload),
    )
  },
)

const trigger = await Events(runtime).emit(eventDraft, { contextId })
const effect = await context.react(trigger, definition)
```

## Invariants

1. Trigger and effects are typed domain Events.
2. Context contains only current and previous durable content.
3. History is selected explicitly with `Events(runtime).query(...)`.
4. `given` receives one Event or an ordered Event array.
5. `agent` is the only model primitive.
6. `action`, `dataset`, `workspace`, `shell`, `git`, and `emit` return Events.
7. Domain writes execute only through registered scoped actions.
8. Files remain links until explicit workspace or Dataset materialization.
9. Child Reactions own child Sessions and may share or replace Context.
10. Workflow and direct execution persist the same graph.

## Implementation status

- [x] Context domain and five-entity InstantDB schema
- [x] Event construction, emission, query, Parts, and file projection
- [x] Reaction definitions, Sessions, causal operations, and child Sessions
- [x] Agent, domain actions, Dataset, workspace, shell, git, and emit
- [x] Workflow-safe idempotent execution
- [x] React subscription over Context, Sessions, Reactions, Events, and Parts
- [x] Dataset action-input validation
- [x] Channel, Evals, Lab, Agent, Registry, and scaffold migration
- [x] Full workspace verification
- [x] ECU reconstruction and revision validation

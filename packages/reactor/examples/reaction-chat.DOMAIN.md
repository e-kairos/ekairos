# Reaction Chat Example

This example demonstrates one durable reaction graph, not a chatbot.

## Domain

- `requestReceived` is the external request Event.
- Four `context.model` Events plan, research, assess risks, and synthesize.
- Research and risk assessment fan out from the plan and run concurrently.
- Synthesis explicitly fans in both branch Events.
- `publishReport` owns the meaningful write and persists one
  `reactionChatExample_report` entity.

## Invariants

- Every model operation is a real scripted Reactor agent call.
- Every agent emits its own provisional stream and durable Event Parts.
- Publication uses the action Reaction id as the report id, so retries overwrite
  the same report rather than creating duplicates.
- Adapters may trigger and observe the reaction, but do not write reports directly.

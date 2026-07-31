# Reactor Boundary

Module: `@ekairos/reactor`

Reactor orchestrates `contextDomain`; it owns no InstantDB schema.

## Concepts

- Context: durable owner of the main Event timeline
- Session: one flat execution configured with domain scope, engine, and optional sandbox
- From: explicit causal points whose full cones are operation material
- Reaction: one persisted operation from cause Events to ordered effect Events
- Agent: the only model-backed primitive
- Dataset, action, loadFiles, storeFiles, shell, and git: observable Session operations

## Invariants

1. `context.session({ scope, engine, sandbox? })` is configuration only.
2. The Session is persisted lazily on its first operation with definition
   `"session"` and the first `from(...)` point as trigger.
3. `session.from(event)` and `session.from([a, b])` accept one Event or an
   ordered, deduplicated array of Events.
4. Every operation creates one child Reaction whose `causeIds` are exactly the
   points passed to `from(...)`.
5. Agent material is the ordered union of the complete causal cones selected
   by `from(...)`. Reaction-produced Events follow their producer Reaction;
   exogenous Events follow `metadata.causeIds`.
6. Every operation returns its last persisted Event. Agent rounds and action
   calls may create multiple ordered effects in that operation Reaction.
7. Fan-out invokes multiple operations from the same Event. Fan-in passes their
   result Events together to `from([...])`.
8. `agent({ datasets })` defaults to Dataset capability enabled. Pass
   `datasets: false` to disable it. The runtime must provide the Dataset
   materializer when enabled.
9. Actions are exposed explicitly per Agent operation through
   `agent({ actions: [...] })`; Session configuration never contains actions.
10. Session operations cannot emit arbitrary domain Events. Exogenous facts use
    `context.append`; state changes use domain actions.
11. `complete()` returns nothing. It completes the root Reaction with the last
    operation result as its effect and completes the Session.
12. An operation failure marks the root Reaction and Session failed before
    rethrowing the error.
13. Direct and Workflow execution use the same graph and step-safe operation
    primitives.

## Canonical coach flow

```ts
const context = await Context(runtime).open({
  key: `rocket:${matchId}`,
  content: match,
})
const message = await context.append(
  rocket.events.messageReceived({ text: userMessage }),
)
const session = context.session({
  scope: rocket,
  engine: ai({ model: "anthropic/claude-haiku-4.5" }),
  sandbox: false,
})

const triage = await session.from(message).agent({
  instruction: "Choose the relevant replay windows.",
  output: triageSchema,
  datasets: false,
})
const analyses = await Promise.all(triage.payload.plays.map(async play => {
  const frames = await session.from(triage).dataset({
    instruction: `Frames ${play.from}-${play.to}`,
    schema: frameSchema,
  })
  return await session.from([triage, frames]).agent({
    instruction: `Analyze ${play.reason} using the frame evidence.`,
    output: analysisSchema,
  })
}))
const final = await session.from(analyses).agent({
  instruction: "Synthesize one coaching paragraph and two priorities.",
  output: coachingSchema,
  datasets: false,
})
await session.complete()
```

Cross-package execution hooks are private under `@ekairos/reactor/internal`.

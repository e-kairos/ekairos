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

1. `Context(runtime).session(contextKey, scope, engine, { sandbox? })` opens
   the Context by key and returns one configured Session.
2. The Session is persisted lazily on its first operation with definition
   `"session"` and the first `from(...)` point as trigger.
3. `session.from(point)` accepts persisted Events, domain Event drafts, or an
   array of both. Drafts are appended in order before the normal causal join.
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
10. The concrete domain scope limits which domain Events may enter `from(...)`
    and which actions may execute.
11. `complete()` returns nothing, is idempotent, and remains an explicit
    optional operation.
12. An operation failure marks the root Reaction and Session failed before
    rethrowing the error.
13. `await using` is canonical: async disposal completes a clean Session and
    preserves an already-failed Session while the operation error escapes.
14. Session implements Workflow serialization/deserialization so the same
    object survives durable replays.

## Deterministic query selection

Queries decide what to inspect, bounded AI interprets that selected evidence,
and a later Agent synthesizes the result. The query-backed Dataset operation
does not invoke the Session engine:

```ts
const moments = await session.from(msg).dataset({
  title: "Momentos importantes",
  query: {
    rocket_replay_events: {
      $: {
        where: { kind: { $in: ["goal", "save"] } },
        order: { time: "asc" },
      },
    },
  },
})
```

Pass `moments` to the bounded analysis Agent, then pass those analysis Events to
the synthesis Agent.

## Canonical coach flow

```ts
const coaching = rocket.scope({
  events: [rocket.events.messageReceived],
  actions: [rocket.actions.publishReview],
})

export async function coach(runtime, matchId, userMessage) {
  "use workflow"

  await using session = await Context(runtime).session(
    `rocket:${matchId}`,
    coaching,
    ai({ model: "anthropic/claude-haiku-4.5" }),
    { sandbox: false },
  )
  const triage = await session.from(
    rocket.events.messageReceived({ text: userMessage }),
  ).agent({
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
  return await session.from(final).action(
    rocket.actions.publishReview,
    { review: final.payload },
  )
}
```

Omit `"use workflow"` only for direct scripts and tests.

Cross-package execution hooks are private under `@ekairos/reactor/internal`.

# @ekairos/evals

Context-based evaluation for Reaction definitions. Every case creates a
persisted Context, emits a typed trigger Event, runs the definition, and scores
its returned effect together with the real Session graph.

```ts
const suite = defineEval({
  key: "inventory.behavior",
  definition: inventoryReaction,
  cases: [{
    key: "bc-5hp",
    event: inventory.events.stockRequested({ sku: "BC-5HP" }),
    content: { warehouse: "AR-01" },
    expected: { unitsInStock: 42 },
  }],
  scorers: [
    scorers.custom("effect_payload", ({ output, expected }) => ({
      score: output.payload.unitsInStock === expected.unitsInStock ? 1 : 0,
    })),
    scorers.sessionCompleted(),
  ],
})

const report = await suite.run({ runtime })
report.cases[0] // { key, contextId, sessionId, output, scores, passed }
```

Each case performs:

```ts
const context = await Context(runtime).create({ content: evalCase.content })
const trigger = await Events(runtime).emit(evalCase.event, { contextId: context.id })
const output = await context.react(trigger, definition)
```

Scorers receive `{ evalCase, output, expected, snapshot }`. The snapshot
contains Session status, ordered Reactions, Events, flattened Event Parts, and
root effects.

Built-ins:

- `scorers.actionCalled(name, { atLeast?, atMost? })`
- `scorers.sessionCompleted(status?)`
- `scorers.llmJudge({ criteria, model? })`
- `scorers.exactOutput()`
- `scorers.custom(name, fn)`

Persisted `eval_results` link to `context_contexts` and `context_sessions`.
Compose `evalDomain` into the application schema when durable reports are
required.

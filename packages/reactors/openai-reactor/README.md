# @ekairos/openai-reactor

Codex/OpenAI reactor package for `@ekairos/events`.

## Exports

- `createCodexReactor(...)`
- `mapCodexChunkType(...)`
- `defaultMapCodexChunk(...)`

## Usage

```ts
import { createCodexReactor } from "@ekairos/openai-reactor";

const reactor = createCodexReactor({
  resolveConfig: async () => {
    "use step";
    return { mode: "local" };
  },
  executeTurn: async () => {
    "use step";
    return {
      providerContextId: "context_1",
      turnId: "turn_1",
      assistantText: "Done.",
      reasoningText: "",
      diff: "",
      toolParts: [],
    };
  },
});
```

## Tests

```bash
pnpm --filter @ekairos/openai-reactor test
pnpm --filter @ekairos/openai-reactor test:reactor
pnpm --filter @ekairos/openai-reactor test:reactor:instant
```

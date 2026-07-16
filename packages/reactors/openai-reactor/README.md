# @ekairos/openai-reactor

Codex engine for the `@ekairos/reactor` Reaction API.

## Exports

- `CodexEngine`
- `codexEngine(...)`
- `CodexEngineConfig`
- `CodexEngineAuthConfig`

## Usage

```ts
import { codexEngine } from "@ekairos/openai-reactor"

const engine = codexEngine({
  model: "gpt-5.5",
  auth: { source: "preinstalled" },
})
```

`CodexEngine` requires a Reaction sandbox. Agent actions are exposed to Codex
as dynamic tools under their canonical names and execute through the wrappers
provided by the Reaction runtime.

## Tests

```bash
pnpm --filter @ekairos/openai-reactor typecheck
pnpm --filter @ekairos/openai-reactor test
```

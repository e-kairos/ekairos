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
  model: "gpt-5.6",
})
```

Without a Reaction sandbox, the engine starts `codex app-server` directly on
the local machine and reuses that process across turns. It uses the current
user's `CODEX_HOME` (or `~/.codex`) and the configured `repoPath` (or the
current working directory).

On Windows, local discovery prefers the current versioned Codex Desktop binary
under `%LOCALAPPDATA%\OpenAI\Codex\bin\<version>\codex.exe`; if it is absent,
the engine resolves `codex.exe` from `PATH`. `codexPath` can select an explicit
binary.

When the Reaction supplies a sandbox, the existing sandbox bridge is used and
prepared once per engine/session. Agent actions are exposed in both modes as
dynamic tools under their canonical names and execute through the wrappers
provided by the Reaction runtime.

## Tests

```bash
pnpm --filter @ekairos/openai-reactor typecheck
pnpm --filter @ekairos/openai-reactor test
CODEX_LOCAL_LIVE=1 pnpm --filter @ekairos/openai-reactor test
```

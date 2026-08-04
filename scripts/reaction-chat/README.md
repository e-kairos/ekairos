# Reaction inspector

Internal CLI for running one reaction adapter repeatedly without a client UI.

The boundary is deliberately strict. A `.ts` reaction file has exactly one
named export and the CLI passes no runtime objects or hidden scope. `react`
returns as soon as the Session starts; the final Event remains in
`returnValue`:

```ts
import type { ReactionChatInput, ReactionChatRun } from "./scripts/reaction-chat/contract.ts"

export async function react(input: ReactionChatInput): Promise<ReactionChatRun> {
  // Return contextId, sessionId, and the running Session's returnValue Promise.
}
```

Run interactively:

```sh
pnpm reaction:chat path/to/reaction.ts --context customer:42
```

The Ink interface is an execution inspector, not a conversation. It renders
structured INPUT, the live causal Event graph with Event Parts, converging
causes, stream projections, and the final OUTPUT. Interactive inputs are JSON.

The reaction panel is a causal navigator:

- `Tab` moves focus between input and reaction.
- `Up` / `Down` follow causal parents and effects.
- `Left` / `Right` move between sibling branches at fan-out and fan-in.
- `Enter` opens the selected Event with its complete payload and Parts.
- In Event detail, `Up` / `Down` scroll and `Enter` / `Escape` returns to the tree.

The selected causal branch is highlighted, other branches are dimmed, and the
viewport remains centered without growing beyond the terminal height.

Each CLI process creates and configures a new Instant app before importing the
reaction module. The app is preserved for inspection after the CLI exits; its
app id is printed, while its admin token remains process-local.

Run one turn for scripts or benchmarks:

```sh
pnpm reaction:chat path/to/reaction.ts \
  --context customer:42 \
  --input '{"text":"Summarize the latest request"}' \
  --json
```

The module is imported again when its file modification time changes. Editing
and saving the reaction file is enough; the interactive CLI does not need to
restart. The `contextKey` remains stable until `/context` or `/new` is used.

`examples/echo.ts` checks the CLI contract without infrastructure.
`packages/reactor/examples/reaction-chat.ts` executes the real
`Context(...).session(...).from(...).agent(...)`
path using the fresh Instant app created by the CLI.

Domain, scope, runtime, engine, sandbox selection, event creation, and reaction
logic all stay explicit in that reaction file.

The CLI subscribes directly to the returned `sessionId`. Human mode updates the
Ink graph and OUTPUT from the live stream. `--json` prints normalized entity
changes and literal stream chunks as NDJSON while `returnValue` is pending.

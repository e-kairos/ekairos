# @ekairos/sandbox

Provider-agnostic sandbox service with durable sandbox ids stored in InstantDB.

## What it does

- creates sandboxes and persists them in `sandbox_sandboxes`
- reconnects by durable `sandboxId`
- runs commands
- reads and writes files
- supports multiple providers behind one API

## Main APIs

- `sandboxDomain`
- `SandboxService`
- `createVercelSandbox(...)`
- `runCommandInSandbox(...)`

## Providers

- `vercel`
- `daytona`
- `sprites`

Provider selection:

1. `config.provider`
2. `SANDBOX_PROVIDER`
3. default provider

## Quick example

```ts
const service = new SandboxService(db);

const created = await service.createSandbox({
  provider: "vercel",
  runtime: "node22",
  timeoutMs: 10 * 60 * 1000,
});

if (!created.ok) throw new Error(created.error);

const run = await service.runCommand(created.data.sandboxId, "node", ["-v"]);
```

## Important ids

- `sandboxId`: durable InstantDB record id
- `externalSandboxId`: provider-native sandbox id

## Tests

```bash
pnpm --filter @ekairos/sandbox test
```

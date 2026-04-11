# Ekairos CLI

CLI for installing and updating Ekairos UI components and agent-facing packages.

## Run

```bash
npx ekairos@latest
```

## Async mode

Use async mode when the caller is another tool or agent.

```bash
npx ekairos --async
```

Resume a session:

```bash
npx ekairos --session <session-id> --input '{"action":"update-all"}'
```

## Local development

```bash
pnpm --filter ekairos build
EKAIROS_REGISTRY_URL=http://localhost:3001 node packages/cli/dist/index.mjs
```

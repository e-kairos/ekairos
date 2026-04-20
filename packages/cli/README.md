# Ekairos CLI

CLI for installing and updating Ekairos UI components and agent-facing packages.

## Run

```bash
npm install -g @ekairos/cli
ekairos --help
```

Create a domain app:

```bash
ekairos create-app ./supply-chain --next --install --smoke --json
```

Run the full local demo cycle:

```bash
ekairos create-app --demo
```

## Async mode

Use async mode when the caller is another tool or agent.

```bash
ekairos --async
```

Resume a session:

```bash
ekairos --session <session-id> --input '{"action":"update-all"}'
```

## Local development

```bash
pnpm --filter @ekairos/cli build
EKAIROS_REGISTRY_URL=http://localhost:3001 node packages/cli/dist/index.mjs
```

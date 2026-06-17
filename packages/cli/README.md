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

Authenticate against Ekairos Platform:

```bash
ekairos login
ekairos whoami
```

Run a registered domain application through Ekairos Platform. The CLI uses the
locally stored Platform OAuth token; Platform calls the application domain
endpoint with the registered application credential.

```bash
ekairos domain query "{ task_tasks: { $: { limit: 5 } } }" \
  --app=<platform-app-id> \
  --env=development \
  --pretty

ekairos domain env register \
  --app=<platform-app-id> \
  --env=development \
  --data='{"orgId":"org_..."}' \
  --pretty

ekairos domain tasks.getTask "{ id: '<task-id>' }" \
  --app=<platform-app-id> \
  --env=development \
  --pretty
```

For local development or browser automation, print the OAuth URL instead of
opening it:

```bash
EKAIROS_AUTH_NO_OPEN=1 ekairos login --platform=http://ekairos-platform.localhost
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
EKAIROS_REGISTRY_URL=http://localhost:3001 node packages/cli/dist/index.js
```

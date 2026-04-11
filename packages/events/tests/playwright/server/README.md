# events workflow smoke

Browser/framework smoke harness for `@ekairos/events`.

Use this only for app-level behavior that really needs a running Next.js server.
The primary workflow contract is now tested with Workflow-Vitest in the package itself.

## Main commands

```bash
pnpm --filter @ekairos/events test:workflow
pnpm --filter @ekairos/events-workflow-smoke test:e2e:context-engine:ai-sdk
pnpm --filter @ekairos/events-workflow-smoke test:e2e:context-engine:scripted
```

## Required env

- `INSTANT_PERSONAL_ACCESS_TOKEN`

Optional app creds can be supplied in local env files when needed by the smoke app.

# workflow-template

Template package used to author a single durable workflow session.

## Rules

- write TypeScript in `src/session.workflow.ts`
- top-level workflow must use `"use workflow"`
- I/O belongs in `"use step"`
- avoid static imports inside workflow/step modules when they pull Node-only code

## Commands

```bash
pnpm compile
pnpm run:local
pnpm test
```

Input is read from `WORKFLOW_INPUT` or env vars such as:

- `ORG_ID`
- `EKAIROS_DOMAIN_BASE_URL`
- `EKAIROS_DOMAIN_OIDC_TOKEN`
- `QUERY`

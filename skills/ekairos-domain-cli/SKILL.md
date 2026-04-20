---
name: ekairos-domain-cli
description: Operate Ekairos apps through the installed ekairos CLI. Use when scaffolding a fresh app, provisioning a starter Next app, inspecting a running domain endpoint, executing domain actions, or querying InstaQL with JSON5, stdin, or files.
---

# ekairos-domain-cli

Use this skill for terminal operation through the installed `ekairos` binary.

## Setup

Install the CLI globally:

```bash
npm install -g @ekairos/cli
```

All examples assume `ekairos` is available on PATH.

## Start From Zero

Prefer the scaffold first:

```bash
ekairos create-app my-app --next --install --smoke
```

For a full local demo cycle:

```bash
ekairos create-app --demo
```

`--demo` uses the supply-chain template, installs dependencies, provisions Instant from `INSTANT_PERSONAL_ACCESS_TOKEN`, runs smoke, and keeps a local review server alive.

For non-interactive agent or CI runs:

```bash
ekairos create-app my-app --next --install --smoke --json
```

When you already have an Instant platform token, let the scaffold provision the app and write `.env.local`:

```bash
ekairos create-app my-app --next --instantToken=$INSTANT_PERSONAL_ACCESS_TOKEN
```

For local monorepo iteration, point the scaffold to the workspace package:

```bash
ekairos create-app my-app --next --workspace /path/to/ekairos
```

## Operate A Running App

No login is required for local apps that accept admin queries through the runtime route:

```bash
ekairos domain inspect --baseUrl=http://localhost:3000 --admin --pretty
ekairos domain "supplyChain.order.launch" "{ reference: 'PO-7842', supplierName: 'Marula Components', sku: 'DRV-2048' }" --baseUrl=http://localhost:3000 --admin --pretty
ekairos domain query "{ procurement_order: { supplier: {}, stockItems: {}, shipments: { inspections: {} } } }" --baseUrl=http://localhost:3000 --admin --pretty
```

New apps expose `/api/ekairos/domain`.
The CLI tries that route first and falls back to legacy `/.well-known/ekairos/v1/domain`.

## Use JSON5 And Files

Prefer JSON5 over strict JSON. This keeps commands readable:

```bash
ekairos domain query "{ procurement_order: { $: { limit: 5 }, supplier: {} } }" --baseUrl=http://localhost:3000 --admin
```

When shell quoting gets ugly, use a file or stdin:

```bash
ekairos domain query @query.json5 --baseUrl=http://localhost:3000 --admin
cat query.json5 | ekairos domain query - --baseUrl=http://localhost:3000 --admin
```

## Use User Contexts

Exactly one auth context should be active:

- `--admin`
- `--as-email <email>`
- `--as-guest`
- `--as-token <refresh-token>`

If the app uses a refresh token, store it once:

```bash
ekairos domain login http://localhost:3000 --refreshToken=<token> --appId=<app-id>
```

Then query again with no extra auth flag to use the client runtime path.

## Debug Shape

Add `--meta` when you need to know whether the result came from the local client runtime or the server route:

```bash
ekairos domain query "{ procurement_order: {} }" --meta
```

## Related Skills

- Domain modeling: `../../packages/domain/SKILL.md`
- CLI package operation: `../../packages/cli/SKILL.md`

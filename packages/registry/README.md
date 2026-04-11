# Ekairos Registry

shadcn-compatible component registry for Ekairos UI packages.

## Start

```bash
pnpm --filter registry dev
```

Default URL:

```txt
http://localhost:3001
```

## Consume from another app

```json
{
  "registries": {
    "@ekairos": "http://localhost:3001/{name}.json"
  }
}
```

Example:

```bash
pnpm dlx shadcn@latest add @ekairos/agent
```

## E2E

```bash
pnpm --filter registry test:e2e
```

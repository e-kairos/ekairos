# Ekairos Registry

Domain-first shadcn-compatible component registry for Ekairos UI packages.
The registry is organized as `domain -> components -> /r/*.json`; domain
runtime APIs stay in package dependencies such as `@ekairos/events`.

## Start

```bash
pnpm --filter registry dev
```

Default URL:

```txt
http://localhost:3030
```

## Consume from another app

```json
{
  "registries": {
    "@ekairos": "http://localhost:3030/r/{name}.json"
  }
}
```

Example for the first published domain component:

```bash
pnpm dlx shadcn@4.8.0 add https://registry.ekairos.dev/r/event-context-panel.json
```

## E2E

```bash
pnpm --filter registry test:e2e
```

# @ekairos/domain

Compose one application graph from many bounded contexts.
Read it with InstantDB.
Write through explicit domain actions.

## What this package does

- define bounded contexts with `domain(...)`
- compose subdomains with `.includes(...)`
- attach write boundaries with `.actions(...)`
- bind execution explicitly with `EkairosRuntime`
- expose domain structure as AI-ready context

## Core model

- reads come from the composed InstantDB schema
- writes go through domain actions
- runtime decides which real app/database is used

## Example

```ts
import { domain, defineDomainAction, EkairosRuntime } from "@ekairos/domain";
import { i } from "@instantdb/core";

export const inventoryDomain = domain("inventory").schema({
  entities: {
    inventory_items: i.entity({
      sku: i.string().indexed(),
      name: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

export const procurementDomain = domain("procurement")
  .includes(inventoryDomain)
  .schema({
    entities: {
      procurement_requests: i.entity({
        title: i.string(),
      }),
    },
    links: {},
    rooms: {},
  })
  .actions({
    normalizeTitle: defineDomainAction({
      name: "procurement.request.normalizeTitle",
      async execute({ input }) {
        "use step";
        return { title: String((input as any).title ?? "").trim() };
      },
    }),
    createRequest: defineDomainAction({
      name: "procurement.request.create",
      async execute({ runtime, input }) {
        "use step";
        const domain = await runtime.use(procurementDomain);
        return await domain.actions.normalizeTitle(input);
      },
    }),
  });
```

## Runtime

Use `runtime.db()` when you want the full graph.
Use `runtime.use(subdomain)` when you want a domain-scoped handle.

Domain actions are step-safe units.
The recommended pattern is:

```ts
async execute({ runtime, input }) {
  "use step";
  const domain = await runtime.use(exportedDomain);
  // action logic
}
```

## Useful APIs

- `domain(...)`
- `composeDomain(...)`
- `defineDomainAction(...)`
- `EkairosRuntime`
- `domain.context()`
- `domain.contextString()`

## Tests

```bash
pnpm --filter @ekairos/domain test
pnpm --filter @ekairos/domain test:workflow
pnpm --filter @ekairos/domain test:e2e
```

# Command Cookbook

## Install

```bash
npm install -g @ekairos/cli
```

All commands below assume `ekairos` is available on PATH.

## Scaffold

```bash
ekairos create-app my-app --next --install --smoke
ekairos create-app my-app --next --instantToken=$INSTANT_PERSONAL_ACCESS_TOKEN
```

For agents and CI:

```bash
ekairos create-app my-app --next --install --smoke --json
```

## Inspect

```bash
ekairos domain inspect --baseUrl=http://localhost:3000 --admin --pretty
```

The CLI defaults to `/api/ekairos/domain` and falls back to legacy `.well-known`.

## Run An Action

```bash
ekairos domain "supplyChain.order.launch" "{ reference: 'PO-7842', supplierName: 'Marula Components', sku: 'DRV-2048' }" --baseUrl=http://localhost:3000 --admin --pretty
```

## Query Nested Data

```bash
ekairos domain query "{ procurement_order: { supplier: {}, stockItems: {}, shipments: { inspections: {} } } }" --baseUrl=http://localhost:3000 --admin --pretty
```

## Query From File

`query.json5`

```json5
{
  procurement_order: {
    $: { limit: 10, order: { createdAt: "desc" } },
    supplier: {},
    stockItems: {},
    shipments: {
      inspections: {}
    }
  }
}
```

Run:

```bash
ekairos domain query @query.json5 --baseUrl=http://localhost:3000 --admin
```

## Switch To User Scope

```bash
ekairos domain login http://localhost:3000 --refreshToken=<token> --appId=<app-id>
ekairos domain query "{ procurement_order: {} }" --meta
```

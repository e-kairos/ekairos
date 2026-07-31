# @ekairos/dataset

`@ekairos/dataset` gives large, durable collections a formal item type and a
Reaction-native materialization path.

## Compose the domain

```ts
import { datasetSchemaDomain } from "@ekairos/dataset/schema"

const appDomain = domain("app")
  .includes(contextDomain)
  .includes(datasetSchemaDomain)
  .includes(requisitionDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
```

`@ekairos/dataset/schema` contains only schema and Event definitions, so it is
safe to compose into schema modules imported by browser code. The main
`@ekairos/dataset` entrypoint exports `datasetDomain`, its server actions, and
the materialization runtime.

## Materialize from the current causal Event

```ts
const itemSchema = z.object({
  code: z.string(),
  description: z.string(),
  quantity: z.number(),
})

const items = await session.from(message).dataset({
  instruction: "Extract one normalized row per requested item.",
  schema: itemSchema,
})

items.payload.datasetId
items.payload.mode       // "opened" | "built"
items.payload.preview    // typed preview only
items.payload.count
```

The selected Event determines the source in this order:

1. linked `$files`
2. prior Dataset handles found in the Event payload
3. an Event payload array, or the selected Event payloads as rows

There is no implicit Context scan. The parent Dataset operation produces a
`context.dataset` Event. Internal materialization uses the same flat Session
surface and persists normal Dataset domain Events through actions.

The preview is diagnostic. Production consumers read durable records or the
Dataset data file by `datasetId`; they do not load millions of rows through the
Reaction Event.

## Let an Agent create Datasets

```ts
const answer = await session.from(history).agent({
  instruction: "Group the complete cohort by recorded condition.",
})
```

If the runtime implements `materializeDataset`, every Agent receives the
`dataset.materialize` capability by default. It can materialize multiple
Datasets from a scoped InstaQL query, selected causal Events, prior Datasets, or
linked files. Query entities, fields, and links are validated against the
Reaction domain before InstantDB is read. Set `datasets: false` only for an
Agent that must not materialize collections.

## Dataset as a domain-action input

```ts
import { dataset } from "@ekairos/dataset"

const itemDataset = dataset(itemSchema)

const addItems = defineDomainAction({
  input: z.object({
    bidId: z.string(),
    items: itemDataset,
  }),
  output: z.object({ added: z.number() }),
  async execute({ input }) {
    return importDatasetItems(input.bidId, input.items.datasetId)
  },
})
```

```ts
const added = await session.from(items).action(
  bid.actions.addItems.scope({ bidId }),
  { items: items.payload },
)
```

Before execution, the runtime recursively finds Dataset-typed inputs and
validates that each Dataset exists, is completed, and stores the same item
schema. A missing, incomplete, or incompatible Dataset fails before business
logic runs.

## Public surface

- `dataset(schema)` and Dataset reference types
- `datasetSchemaDomain` from `@ekairos/dataset/schema`
- `datasetDomain` and `datasetActions` from the server entrypoint
- `DatasetService`
- formal notation helpers
- `buildReactionDataset`, the runtime integration assigned to
  `runtime.materializeDataset`
- `remoteDatasetStore`, the endpoint-backed materialize/read/aggregate client

The source builder remains an internal materialization implementation. New
application code materializes through Reaction Events.

## Remote Dataset store

`remoteDatasetStore` uses the Dataset collection endpoint as-is. For example,
if Dataset creation is `https://platform.example/api/platform/dataset`, pass
that full URL as `endpoint`.

```ts
import {
  buildReactionDataset,
  remoteDatasetOptionsFromEnv,
} from "@ekairos/dataset"

const datasetOptions = remoteDatasetOptionsFromEnv()

class AppRuntime extends EkairosRuntime<any, typeof appDomain, any> {
  async materializeDataset(
    input: Parameters<typeof buildReactionDataset>[0],
  ) {
    return await buildReactionDataset(input, datasetOptions)
  }
}
```

An empty remote configuration returns `undefined`, so the runtime above keeps
the Instant default. A partial configuration fails immediately. The required
variables are:

```text
EKAIROS_DATASET_ENDPOINT=https://platform.example/api/platform/dataset
EKAIROS_DATASET_TOKEN=...
EKAIROS_DATASET_APP=registered-app-id
EKAIROS_DATASET_ENV=development
EKAIROS_DATASET_ORGANIZATION_ID=... # optional
```

The endpoint client sends `Authorization: Bearer <token>` and, when configured,
`x-ekairos-organization-id`. Its exact operations are:

```ts
const store = remoteDatasetStore({ endpoint, token, organizationId })

await store.materialize({
  app,
  env,
  name,
  source: { kind: "rows", rows },
})

await store.rows({
  datasetId,
  select,
  where,
  sort,
  limit,
  offset,
})

await store.aggregate({
  datasetId,
  groupBy,
  metric, // count() | sum(column) | avg(column) | min(column) | max(column)
  where,
})
```

Inline materialization is limited to 10,000 rows. Larger results fail clearly
and are never truncated. InstaQL is executed by the active runtime and uploaded
as inline rows; it is not remote query pushdown. When a Reaction Dataset needs
local transforms, Instant remains the staging store and the final transformed
rows are uploaded.

The gated live contract test runs automatically when the four required
variables above are present. `EKAIROS_DATASET_ORGANIZATION_ID` remains
optional:

```bash
pnpm --filter @ekairos/dataset test -- --run \
  src/tests/remoteDatasetStore.live.test.ts
```

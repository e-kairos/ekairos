# @ekairos/dataset

`@ekairos/dataset` gives large, durable collections a formal item type and a
Reaction-native materialization path.

## Compose the domain

```ts
const appDomain = domain("app")
  .includes(contextDomain)
  .includes(datasetDomain)
  .includes(requisitionDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withActions(datasetDomain.actions)
```

## Materialize from the current causal Event

```ts
const itemSchema = z.object({
  code: z.string(),
  description: z.string(),
  quantity: z.number(),
})

const items = await reaction.given(reaction.trigger).dataset({
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
`context.dataset` Event. Materialization runs under a linked child Session and
emits normal Dataset domain Events.

The preview is diagnostic. Production consumers read durable records or the
Dataset data file by `datasetId`; they do not load millions of rows through the
Reaction Event.

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
const added = await reaction.given(items).action(
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
- `datasetDomain` and `datasetActions`
- `DatasetService`
- formal notation helpers
- `buildReactionDataset`, the runtime integration assigned to
  `runtime.materializeDataset`

The source builder remains an internal materialization implementation. New
application code materializes through Reaction Events.

import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"

import { dataset } from "../dataset"
import { datasetDomain } from "../schema"

type Env = Record<string, unknown> & {
  orgId: string
}

const queryDomain = domain("dataset-query-typing-resource").schema({
  entities: {
    query_items: i.entity({
      title: i.string().indexed(),
      quantity: i.number().indexed(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-query-typing-app")
  .includes(datasetDomain)
  .includes(queryDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

class AppRuntime extends EkairosRuntime<Env, typeof appDomain, any> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

const runtime = new AppRuntime({ orgId: "org_1" })

// given: queryDomain exposes query_items with title and quantity fields.
// when: callers write an InstaQL query through dataset.fromQuery.
// then: the query parameter accepts the same entity and where-field shape that
// InstantDB accepts for db.query with this domain schema.
dataset(runtime).fromQuery(queryDomain, {
  query: {
    query_items: {
      $: {
        where: {
          title: "Ready",
          quantity: { $gte: 1 },
        },
        order: {
          quantity: "desc",
        },
        limit: 10,
      },
    },
  },
})

// given: query validation is scoped to queryDomain, not datasetDomain.
// when: callers query an entity that is not declared by queryDomain.
// then: TypeScript rejects the query object before it can be passed to InstantDB.
dataset(runtime).fromQuery(queryDomain, {
  // @ts-expect-error unknown_entities is not part of queryDomain
  query: {
    unknown_entities: {},
  },
})

// given: query_items has title and quantity fields, but no missingField.
// when: callers filter query_items by an unknown field.
// then: the same ValidQuery constraint used by InstantDB rejects the where
// clause through the dataset builder.
dataset(runtime).fromQuery(queryDomain, {
  query: {
    query_items: {
      $: {
        // @ts-expect-error missingField is not a query_items field
        where: {
          missingField: "value",
        },
      },
    },
  },
})

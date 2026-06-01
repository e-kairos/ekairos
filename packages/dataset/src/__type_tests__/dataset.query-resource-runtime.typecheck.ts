import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"

import { dataset } from "../dataset"
import { datasetDomain } from "../schema"

type Env = Record<string, unknown> & {
  orgId: string
}

const queryDomain = domain("dataset-query").schema({
  entities: {
    query_items: i.entity({
      title: i.string().indexed(),
    }),
  },
  links: {},
  rooms: {},
})

const queryContainerDomain = domain("dataset-query-container")
  .includes(queryDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const incompatibleSameNameQueryDomain = domain("dataset-query").schema({
  entities: {
    incompatible_items: i.entity({
      label: i.string(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-query-runtime-app")
  .includes(datasetDomain)
  .includes(queryDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const appWithTransitiveQueryDomain = domain("dataset-transitive-query-runtime-app")
  .includes(datasetDomain)
  .includes(queryContainerDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const datasetOnlyDomain = domain("dataset-only-runtime-app")
  .includes(datasetDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

class AppRuntime extends EkairosRuntime<Env, typeof appDomain, any> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

class TransitiveAppRuntime extends EkairosRuntime<Env, typeof appWithTransitiveQueryDomain, any> {
  protected getDomain() {
    return appWithTransitiveQueryDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

class DatasetOnlyRuntime extends EkairosRuntime<Env, typeof datasetOnlyDomain, any> {
  protected getDomain() {
    return datasetOnlyDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

const runtime = new AppRuntime({ orgId: "org_1" })
const transitiveRuntime = new TransitiveAppRuntime({ orgId: "org_1" })
const datasetOnlyRuntime = new DatasetOnlyRuntime({ orgId: "org_1" })

// given: the runtime root includes both datasetDomain and the query resource
// domain.
// when: callers materialize a dataset from a query-domain query.
// then: fromQuery accepts the query domain because runtime.use(queryDomain)
// is valid for that same runtime.
dataset(runtime).fromQuery(queryDomain, {
  query: {
    query_items: {},
  },
})

// given: queryDomain is included through queryContainerDomain rather than
// directly at the runtime root.
// when: callers pass the leaf queryDomain to fromQuery.
// then: transitive included-domain names and schema keep the runtime compatible.
dataset(transitiveRuntime).fromQuery(queryDomain, {
  query: {
    query_items: {},
  },
})

// The dataset builder still accepts context-first materialization. Runtime
// compatibility for query domains is exercised by the positive cases above;
// context resources are validated at runtime because they are durable data.
dataset(datasetOnlyRuntime).fromContext({ key: "ctx_dataset_only" })

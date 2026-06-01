import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"

import { createMaterializeDatasetTool } from "../materializeDataset.tool"
import { datasetDomain } from "../schema"

type Env = Record<string, unknown> & {
  orgId: string
}

const queryDomain = domain("dataset-tool-query").schema({
  entities: {
    query_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
})

const appDomain = domain("dataset-tool-app")
  .includes(datasetDomain)
  .includes(queryDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const datasetOnlyDomain = domain("dataset-tool-dataset-only")
  .includes(datasetDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const queryOnlyDomain = domain("dataset-tool-query-only")
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

class DatasetOnlyRuntime extends EkairosRuntime<Env, typeof datasetOnlyDomain, any> {
  protected getDomain() {
    return datasetOnlyDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

class QueryOnlyRuntime extends EkairosRuntime<Env, typeof queryOnlyDomain, any> {
  protected getDomain() {
    return queryOnlyDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

const runtime = new AppRuntime({ orgId: "org_1" })
const datasetOnlyRuntime = new DatasetOnlyRuntime({ orgId: "org_1" })
const queryOnlyRuntime = new QueryOnlyRuntime({ orgId: "org_1" })

// given: the tool runtime can persist datasets and query the configured query
// domain.
// when: createMaterializeDatasetTool receives that runtime and query domain.
// then: TypeScript accepts the tool configuration.
createMaterializeDatasetTool({
  runtime,
  queryDomain: queryDomain,
})

// Runtime compatibility for the tool is primarily exercised by the accepted
// configuration above. Context/resource materialization is validated at runtime
// because context resources are durable data.

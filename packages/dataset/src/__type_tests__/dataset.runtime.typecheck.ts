import { i } from "@instantdb/core"
import {
  domain,
  type IncludedDomainNamesOf,
} from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"

import { materializeDataset } from "../dataset"
import { datasetDomain } from "../schema"

type Env = Record<string, unknown> & {
  orgId: string
}

const appDomain = domain("dataset-runtime-app")
  .includes(datasetDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

const unrelatedDomain = domain("dataset-runtime-unrelated").schema({
  entities: {
    unrelated_items: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
})

class DatasetAppRuntime extends EkairosRuntime<Env, typeof appDomain, any> {
  protected getDomain() {
    return appDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

class UnrelatedRuntime extends EkairosRuntime<Env, typeof unrelatedDomain, any> {
  protected getDomain() {
    return unrelatedDomain
  }

  protected resolveDb() {
    return {} as any
  }
}

const compatibleRuntime = new DatasetAppRuntime({ orgId: "org_1" })
const unrelatedRuntime = new UnrelatedRuntime({ orgId: "org_1" })
const includedName: IncludedDomainNamesOf<typeof appDomain> = "dataset"

// given: dataset persistence is owned by datasetDomain, and the app runtime
// includes datasetDomain at its root.
// when: callers create a dataset builder from that runtime.
// then: the builder is accepted and every later dataset read/write can use
// runtime.use(datasetDomain) without falling back to an env-global resolver.
compatibleRuntime.use(datasetDomain)
materializeDataset(compatibleRuntime).fromDataset({ datasetId: "resource_dataset_1" })
// @ts-expect-error Context identity is not a Dataset source; pass explicit files, rows, datasets, or queries.
materializeDataset(compatibleRuntime).fromContext({ id: "context_1" })

// given: a runtime whose root domain has no datasetDomain schema.
// when: callers try to create a dataset builder from that runtime.
// then: TypeScript rejects it before any dataset operation can run.
// @ts-expect-error runtime root domain must include datasetDomain
materializeDataset(unrelatedRuntime)

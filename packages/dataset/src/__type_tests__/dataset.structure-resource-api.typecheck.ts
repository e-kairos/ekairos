import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"

import { dataset } from "../dataset"
import { datasetDomain } from "../schema"

type Env = Record<string, unknown> & {
  orgId: string
}

const appDomain = domain("dataset-structure-resource-api")
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

const runtime = new AppRuntime({ orgId: "org_1" })

// given: structure callers pass explicit kind-tagged file, text, and dataset
// resources to `.from(...)`.
// when: the same resource shape is used with dataset.
// then: dataset accepts the structure-compatible resource shape without requiring
// callers to switch to fromFile/fromText/fromDataset.
dataset(runtime).from(
  { kind: "file", fileId: "file_1", description: "uploaded csv" },
  { kind: "text", text: "code,price\nA1,10", mimeType: "text/csv", name: "inline.csv" },
  { kind: "dataset", datasetId: "dataset_1", description: "existing dataset" },
)

// given: dataset also keeps the more ergonomic resource-specific methods.
// when: callers omit the explicit resource kind in `.from(...)`.
// then: the builder still accepts file, text, and existing dataset resources.
dataset(runtime).from(
  { fileId: "file_1" },
  { text: "plain text", name: "input.txt" },
  { datasetId: "dataset_1" },
)

// given: query resources require a second domain and runtime compatibility check.
// when: callers try to sneak a query resource through structure-style `.from(...)`.
// then: the public resource union rejects it so query materialization must go
// through `.fromQuery(queryDomain, ...)`.
dataset(runtime).from(
  // @ts-expect-error query resources must use fromQuery(queryDomain, resource)
  { kind: "query", query: { any_entity: {} } },
)

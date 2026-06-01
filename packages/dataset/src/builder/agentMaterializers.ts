import type { AnyDatasetRuntime, DatasetBuilderState, InternalDatasetResource } from "./types.js"

export type DatasetAgentMaterializers = {
  materializeSingleFileLikeResource<Runtime extends AnyDatasetRuntime>(
    state: DatasetBuilderState<Runtime>,
    resource: Extract<InternalDatasetResource, { kind: "file" | "text" }>,
    targetDatasetId: string,
  ): Promise<string>
  materializeDerivedDataset<Runtime extends AnyDatasetRuntime>(
    state: DatasetBuilderState<Runtime>,
    targetDatasetId: string,
  ): Promise<string>
}

let agentMaterializers: DatasetAgentMaterializers | null = null

export function registerDatasetAgentMaterializers(materializers: DatasetAgentMaterializers) {
  agentMaterializers = materializers
}

export function getDatasetAgentMaterializers(): DatasetAgentMaterializers {
  if (!agentMaterializers) {
    throw new Error("dataset_agent_materializers_not_registered")
  }
  return agentMaterializers
}

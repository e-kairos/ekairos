import type { DomainInstantSchema, DomainSchemaResult } from "@ekairos/domain"
import type { ContextReactor } from "@ekairos/events"
import type { ValidQuery } from "@instantdb/core"

import { buildObjectOutputInstructions } from "./builder/instructions.js"
import { resolveDatasetResourceContext } from "./builder/context.js"
import { createDatasetId } from "./id.js"
import {
  completeDatasetStep,
  materializeDerivedDataset,
  materializeSingleFileLikeResource,
} from "./builder/materialize.js"
import { materializeQueryResource } from "./builder/materializeQuery.js"
import {
  createDatasetBuildResult,
  finalizeBuildResult,
} from "./builder/persistence.js"
import type {
  AnyDatasetRuntime,
  CompatibleQueryDomain,
  DatasetBuilder,
  DatasetBuilderOptions,
  DatasetBuildOptions,
  DatasetBuildResult,
  DatasetBuilderState,
  DatasetExistingResourceInput,
  DatasetFileResourceInput,
  DatasetOutput,
  DatasetQueryResourceOptions,
  DatasetRuntimeEnv,
  DatasetRuntimeHandle,
  DatasetSchemaInput,
  DatasetResourceInput,
  DatasetTextResourceInput,
  InternalDatasetResource,
} from "./builder/types.js"

export type {
  AnyDatasetRuntime,
  CompatibleQueryDomain,
  DatasetBuilder,
  DatasetBuilderOptions,
  DatasetBuildOptions,
  DatasetBuildResult,
  DatasetExistingResource,
  DatasetExistingResourceInput,
  DatasetFileResource,
  DatasetFileResourceInput,
  DatasetMode,
  DatasetOutput,
  DatasetQueryResourceInput,
  DatasetReader,
  DatasetReaderResult,
  DatasetRuntimeEnv,
  DatasetRuntimeHandle,
  DatasetSchemaInput,
  DatasetTextResource,
  DatasetResourceInput,
  DatasetTextResourceInput,
} from "./builder/types.js"

export function dataset<Runtime extends AnyDatasetRuntime>(
  runtime: Runtime & DatasetRuntimeHandle<Runtime>,
  options: DatasetBuilderOptions = {},
): DatasetBuilder<Runtime> {
  const datasetId = normalizeDatasetId(options.datasetId)
  const typedRuntime = runtime as Runtime
  const state: DatasetBuilderState<Runtime> = {
    runtime: typedRuntime,
    env: typedRuntime.env as Runtime["env"] & DatasetRuntimeEnv,
    resources: [],
    output: "rows",
    inferSchema: false,
    durable: options.durable,
    first: false,
  }

  const api: DatasetBuilder<Runtime> = {
    datasetId,

    fromFile(resource: DatasetFileResourceInput) {
      state.resources.push({ kind: "file", ...resource } as InternalDatasetResource)
      return api
    },

    fromText(resource: DatasetTextResourceInput) {
      state.resources.push({ kind: "text", ...resource } as InternalDatasetResource)
      return api
    },

    fromDataset(resource: DatasetExistingResourceInput) {
      state.resources.push({ kind: "dataset", ...resource } as InternalDatasetResource)
      return api
    },

    fromContext(context) {
      state.resources.push({ kind: "context", ...context } as InternalDatasetResource)
      return api
    },

    from(...resources: DatasetResourceInput[]) {
      for (const resource of resources) {
        if ("kind" in resource) {
          state.resources.push(resource as InternalDatasetResource)
          continue
        }
        if ("fileId" in resource) {
          state.resources.push({ kind: "file", ...resource } as InternalDatasetResource)
          continue
        }
        if ("datasetId" in resource) {
          state.resources.push({ kind: "dataset", ...resource } as InternalDatasetResource)
          continue
        }
        if ("id" in resource || "key" in resource) {
          state.resources.push({ kind: "context", ...resource } as InternalDatasetResource)
          continue
        }
        state.resources.push({ kind: "text", ...resource } as InternalDatasetResource)
      }
      return api
    },

    fromQuery<
      D extends DomainSchemaResult,
      Q extends ValidQuery<Q, DomainInstantSchema<D>>,
    >(
      domain: CompatibleQueryDomain<Runtime, D>,
      resource: DatasetQueryResourceOptions<D, Q>,
    ) {
      state.resources.push({ kind: "query", domain, ...resource } as InternalDatasetResource)
      return api
    },

    title(title: string) {
      state.title = title
      return api
    },

    sandbox(input: { sandboxId: string }) {
      state.sandboxId = String(input?.sandboxId ?? "").trim()
      return api
    },

    schema(schema: DatasetSchemaInput) {
      state.outputSchema = schema
      state.inferSchema = false
      return api
    },

    inferSchema() {
      state.outputSchema = undefined
      state.inferSchema = true
      return api
    },

    auto() {
      state.outputSchema = undefined
      state.inferSchema = true
      return api
    },

    asRows() {
      state.output = "rows"
      return api
    },

    asObject() {
      state.output = "object"
      state.first = true
      return api
    },

    instructions(instructions: string) {
      state.instructions = instructions
      return api
    },

    reactor(reactor: ContextReactor<any, any>) {
      state.reactor = reactor
      return api
    },

    first() {
      state.first = true
      return api
    },

    async build(options?: DatasetBuildOptions): Promise<DatasetBuildResult> {
      if (state.resources.length === 0) {
        throw new Error("dataset_resources_required")
      }

      const targetDatasetId = options?.datasetId
        ? normalizeDatasetId(options.datasetId)
        : datasetId
      const stateWithBuildOptions: DatasetBuilderState<Runtime> = {
        ...state,
        durable: options?.durable ?? state.durable,
      }
      const context = await resolveDatasetResourceContext(
        typedRuntime,
        targetDatasetId,
        stateWithBuildOptions.resources,
      )
      stateWithBuildOptions.resources = context.resources
      stateWithBuildOptions.contextId = context.contextId
      stateWithBuildOptions.contextResources = context.contextResources as any
      const effectiveState: DatasetBuilderState<Runtime> =
        stateWithBuildOptions.output === "object"
          ? {
              ...stateWithBuildOptions,
              first: true,
              instructions: buildObjectOutputInstructions(stateWithBuildOptions.instructions),
            }
          : stateWithBuildOptions
      const onlyResource = effectiveState.resources[0]
      const isSingleResource = effectiveState.resources.length === 1
      const hasInstructions = Boolean(String(effectiveState.instructions ?? "").trim())

      if (isSingleResource && onlyResource.kind === "query" && !hasInstructions) {
        await materializeQueryResource(effectiveState.runtime, onlyResource, {
          datasetId: targetDatasetId,
          sandboxId: effectiveState.sandboxId,
          schema: effectiveState.outputSchema,
          title: effectiveState.title ?? onlyResource.title,
          instructions: effectiveState.instructions,
          first: effectiveState.first,
          contextId: effectiveState.contextId ?? "",
        })
        return finalizeOutputResult(
          await finalizeBuildResult(effectiveState.runtime, targetDatasetId, effectiveState.first),
          effectiveState.output,
        )
      }

      if (isSingleResource && (onlyResource.kind === "file" || onlyResource.kind === "text")) {
        if (!effectiveState.reactor) {
          throw new Error("dataset_reactor_required")
        }
        await materializeSingleFileLikeResource(
          effectiveState,
          onlyResource as any,
          targetDatasetId,
        )
        const completed = await completeDatasetStep({
          runtime: effectiveState.runtime,
          datasetId: targetDatasetId,
          schema: effectiveState.outputSchema,
          first: effectiveState.first,
        })
        return finalizeOutputResult(
          createDatasetBuildResult(effectiveState.runtime, completed),
          effectiveState.output,
        )
      }

      if (!effectiveState.reactor) {
        throw new Error("dataset_reactor_required")
      }
      await materializeDerivedDataset(effectiveState, targetDatasetId)
      const completed = await completeDatasetStep({
        runtime: effectiveState.runtime,
        datasetId: targetDatasetId,
        schema: effectiveState.outputSchema,
        first: effectiveState.first,
      })
      return finalizeOutputResult(
        createDatasetBuildResult(effectiveState.runtime, completed),
        effectiveState.output,
      )
    },
  }

  return api
}

function normalizeDatasetId(datasetId?: string): string {
  const normalized = String(datasetId ?? createDatasetId()).trim()
  if (!normalized) {
    throw new Error("dataset_id_required")
  }
  return normalized
}

function finalizeOutputResult(result: DatasetBuildResult, output: DatasetOutput): DatasetBuildResult {
  if (output !== "object") return result
  return {
    ...result,
    object: result.firstRow ?? null,
  }
}

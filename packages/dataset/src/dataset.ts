import type {
  DomainInstantSchema,
  IncludedDomainNamesOf,
  MaterializedDomainLike,
} from "@ekairos/domain"
import { registerDomainActionInputResolver } from "@ekairos/domain/internal"
import type { ValidQuery } from "@instantdb/core"
import type { z } from "zod"

import { buildObjectOutputInstructions } from "./builder/instructions.js"
import { resolveDatasetSourceContext } from "./builder/context.js"
import { createDatasetId } from "./id.js"
import { datasetDomain } from "./schema.js"
import {
  completeDatasetStep,
  materializeDerivedDataset,
  materializeSingleFileLikeSource,
} from "./builder/materialize.js"
import { materializeQuerySource } from "./builder/materializeQuery.js"
import {
  createDatasetType,
  getDatasetItemSchema,
  isZodType,
  type DatasetType,
} from "./datasetType.js"
import { createDatasetActionInputResolver } from "./actionInput.js"
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
  DatasetExistingSourceInput,
  DatasetFileSourceInput,
  DatasetOutput,
  DatasetQuerySourceOptions,
  DatasetReactionEngine,
  DatasetRuntimeEnv,
  DatasetRuntimeHandle,
  DatasetSchemaInput,
  DatasetSourceInput,
  DatasetTextSourceInput,
  InternalDatasetSource,
} from "./builder/types.js"

export type {
  AnyDatasetRuntime,
  CompatibleQueryDomain,
  DatasetBuilder,
  DatasetBuilderOptions,
  DatasetBuildOptions,
  DatasetBuildResult,
  DatasetExistingSource,
  DatasetExistingSourceInput,
  DatasetFileSource,
  DatasetFileSourceInput,
  DatasetMode,
  DatasetOutput,
  DatasetQuerySourceInput,
  DatasetReader,
  DatasetReaderResult,
  DatasetRuntimeEnv,
  DatasetRuntimeHandle,
  DatasetSchemaInput,
  DatasetTextSource,
  DatasetSourceInput,
  DatasetTextSourceInput,
} from "./builder/types.js"
export type { Dataset, DatasetReference, DatasetType } from "./datasetType.js"
export { DATASET_JSON_SCHEMA_KEY } from "./datasetType.js"

type RuntimeRootDomain<Runtime extends AnyDatasetRuntime> = NonNullable<
  ReturnType<Runtime["meta"]>["domain"]
>

type DatasetRuntimeBoundary<Runtime extends AnyDatasetRuntime> =
  Exclude<
    IncludedDomainNamesOf<typeof datasetDomain>,
    IncludedDomainNamesOf<RuntimeRootDomain<Runtime>>
  > extends never
    ? unknown
    : never

export type DatasetCompatibleRuntime<Runtime extends AnyDatasetRuntime> =
  Runtime & DatasetRuntimeBoundary<NoInfer<Runtime>>

export function dataset<TItemSchema extends z.ZodType>(
  itemType: TItemSchema,
): DatasetType<TItemSchema>
export function dataset(itemType: z.ZodType): DatasetType<z.ZodType> {
  if (!isZodType(itemType)) throw new Error("dataset_item_schema_required")
  const type = createDatasetType(itemType)
  registerDomainActionInputResolver(
    type,
    createDatasetActionInputResolver(getDatasetItemSchema(type)),
  )
  return type
}

export function materializeDataset<Runtime extends AnyDatasetRuntime>(
  runtime: DatasetCompatibleRuntime<Runtime>,
  options: DatasetBuilderOptions = {},
): DatasetBuilder<Runtime> {
  return createDatasetBuilder(runtime, options)
}

function createDatasetBuilder<Runtime extends AnyDatasetRuntime>(
  runtime: DatasetCompatibleRuntime<Runtime>,
  options: DatasetBuilderOptions,
): DatasetBuilder<Runtime> {
  const datasetId = normalizeDatasetId(options.datasetId)
  const typedRuntime = runtime as Runtime & DatasetRuntimeHandle<Runtime>
  const state: DatasetBuilderState<Runtime> = {
    runtime: typedRuntime,
    env: typedRuntime.env as Runtime["env"] & DatasetRuntimeEnv,
    sources: [],
    output: "rows",
    inferSchema: false,
    parentSessionId: options.parentSessionId,
    first: false,
  }

  const api: DatasetBuilder<Runtime> = {
    datasetId,

    fromFile(resource: DatasetFileSourceInput) {
      state.sources.push({ kind: "file", ...resource } as InternalDatasetSource)
      return api
    },

    fromText(resource: DatasetTextSourceInput) {
      state.sources.push({ kind: "text", ...resource } as InternalDatasetSource)
      return api
    },

    fromDataset(resource: DatasetExistingSourceInput) {
      state.sources.push({ kind: "dataset", ...resource } as InternalDatasetSource)
      return api
    },

    from(...sources: DatasetSourceInput[]) {
      for (const source of sources) {
        if ("kind" in source) {
          state.sources.push(source as InternalDatasetSource)
          continue
        }
        if ("fileId" in source) {
          state.sources.push({ kind: "file", ...source } as InternalDatasetSource)
          continue
        }
        if ("datasetId" in source) {
          state.sources.push({ kind: "dataset", ...source } as InternalDatasetSource)
          continue
        }
        state.sources.push({ kind: "text", ...source } as InternalDatasetSource)
      }
      return api
    },

    fromQuery<
      D extends MaterializedDomainLike,
      Q extends ValidQuery<Q, DomainInstantSchema<D>>,
    >(
      domain: CompatibleQueryDomain<Runtime, D>,
      resource: DatasetQuerySourceOptions<D, Q>,
    ) {
      state.sources.push({ kind: "query", domain, ...resource } as InternalDatasetSource)
      return api
    },

    title(title: string) {
      state.title = title
      return api
    },

    sandbox(sandboxId: string) {
      const normalizedId = String(sandboxId ?? "").trim()
      if (!normalizedId) throw new Error("dataset_sandbox_id_required")
      state.sandboxId = normalizedId
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

    engine(engine: DatasetReactionEngine) {
      state.engine = engine
      return api
    },

    first() {
      state.first = true
      return api
    },

    async build(options?: DatasetBuildOptions): Promise<DatasetBuildResult> {
      if (state.sources.length === 0) {
        throw new Error("dataset_sources_required")
      }

      const targetDatasetId = options?.datasetId
        ? normalizeDatasetId(options.datasetId)
        : datasetId
      const stateWithBuildOptions: DatasetBuilderState<Runtime> = { ...state }
      const context = await resolveDatasetSourceContext(
        typedRuntime,
        targetDatasetId,
        stateWithBuildOptions.sources,
      )
      stateWithBuildOptions.sources = context.sources
      stateWithBuildOptions.contextId = context.contextId
      stateWithBuildOptions.sourceDescriptors = context.sourceDescriptors
      const effectiveState: DatasetBuilderState<Runtime> =
        stateWithBuildOptions.output === "object"
          ? {
              ...stateWithBuildOptions,
              first: true,
              instructions: buildObjectOutputInstructions(stateWithBuildOptions.instructions),
            }
          : stateWithBuildOptions
      const onlySource = effectiveState.sources[0]
      const isSingleSource = effectiveState.sources.length === 1
      const hasInstructions = Boolean(String(effectiveState.instructions ?? "").trim())

      if (isSingleSource && onlySource.kind === "query" && !hasInstructions) {
        await materializeQuerySource(effectiveState.runtime, onlySource, {
          datasetId: targetDatasetId,
          sandboxId: effectiveState.sandboxId,
          schema: effectiveState.outputSchema,
          title: effectiveState.title ?? onlySource.title,
          instructions: effectiveState.instructions,
          first: effectiveState.first,
          contextId: effectiveState.contextId ?? "",
        })
        return finalizeOutputResult(
          await finalizeBuildResult(effectiveState.runtime, targetDatasetId, effectiveState.first),
          effectiveState.output,
        )
      }

      if (isSingleSource && (onlySource.kind === "file" || onlySource.kind === "text")) {
        await materializeSingleFileLikeSource(
          effectiveState,
          onlySource as any,
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

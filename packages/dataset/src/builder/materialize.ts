import { lookup } from "@instantdb/admin"
import { ContextHandle } from "@ekairos/events"
import { Session, getSessionId } from "@ekairos/reactor/internal"
import { z } from "zod"

import { datasetDomain } from "../domain.js"
import {
  datasetGetByIdStep,
  datasetInferAndUpdateSchemaStep,
  datasetPreviewRowsStep,
  datasetReadOneStep,
} from "../dataset/steps.js"
import {
  getDatasetOutputPath,
  getDatasetScriptsDir,
  getDatasetSourcesDir,
  getDatasetStandardDirs,
} from "../datasetFiles.js"
import { registerDatasetAgentMaterializers } from "./agentMaterializers.js"
import {
  buildFileDefaultInstructions,
  buildTransformInstructions,
} from "./instructions.js"
import {
  createOrUpdateDatasetMetadata,
  materializeRowsToDataset,
  uploadInlineTextSource,
} from "./persistence.js"
import { materializeQuerySource } from "./materializeQuery.js"
import type {
  AnyDatasetRuntime,
  DatasetBuilderState,
  DatasetSchemaInput,
  InternalDatasetSource,
} from "./types.js"
import type { SandboxState } from "../file/file-dataset.types.js"
import type { FilePreviewContext } from "../file/filepreview.types.js"
import type {
  TransformSandboxState,
  TransformInputPreviewContext,
} from "../transform/transform-dataset.types.js"

function makeIntermediateDatasetId(targetDatasetId: string, resourceKind: string, index: number) {
  return `${targetDatasetId}__${resourceKind}_${index}`
}

function parseContentDispositionFileName(value: unknown): string {
  const text = String(value ?? "")
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(text)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).trim()
    } catch {
      return utf8Match[1].trim()
    }
  }

  const quotedMatch = /filename="([^"]+)"/i.exec(text)
  if (quotedMatch?.[1]) return quotedMatch[1].trim()

  const plainMatch = /filename=([^;]+)/i.exec(text)
  if (plainMatch?.[1]) return plainMatch[1].trim()

  return ""
}

function isPdfContentDisposition(value: unknown): boolean {
  const text = String(value ?? "").toLowerCase()
  return text.includes("application/pdf") || text.includes(".pdf")
}

function sanitizeSourceFileName(value: unknown, fallback: string): string {
  const name = String(value ?? "").trim() || fallback
  const cleaned = name.replace(/[\\/:"*?<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 120)
  return cleaned || fallback
}

function sanitizePdfFileName(value: unknown, fallback: string): string {
  const cleaned = sanitizeSourceFileName(value, fallback)
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`
}

function pdfTextRowsSchema(): DatasetSchemaInput {
  return {
    title: "PdfTextPage",
    description: "Extracted PDF page text",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["fileId", "fileName", "pageNumber", "text"],
      properties: {
        fileId: { type: "string" },
        fileName: { type: "string" },
        pageNumber: { type: "number" },
        text: { type: "string" },
      },
    },
  }
}

function parseJsonlDataRows(content: string): any[] {
  return String(content ?? "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((record) => record?.data)
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
}

async function tryMaterializeRawPdfFileSource<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  resource: Extract<InternalDatasetSource, { kind: "file" }>,
  targetDatasetId: string,
): Promise<string | null> {
  const { readInstantFileStep } = await import("../file/steps.js")
  const {
    readDatasetSandboxTextFileStep,
    runDatasetSandboxCommandStep,
    writeDatasetSandboxFilesStep,
    writeDatasetSandboxTextFilesStep,
  } = await import("../sandbox/steps.js")
  const file = await readInstantFileStep({ runtime: state.runtime, fileId: resource.fileId })
  if (!isPdfContentDisposition(file.contentDisposition)) return null

  const sandboxId = resolveDatasetSandboxId(state, targetDatasetId)
  const outputPath = getDatasetOutputPath(targetDatasetId)
  const fileName = sanitizePdfFileName(
    parseContentDispositionFileName(file.contentDisposition),
    `${resource.fileId}.pdf`,
  )
  const resourcePath = `${getDatasetSourcesDir(targetDatasetId)}/${fileName}`
  const scriptPath = `${getDatasetScriptsDir(targetDatasetId)}/extract_pdf_text.py`

  await runDatasetSandboxCommandStep({
    runtime: state.runtime,
    sandboxId,
    cmd: "mkdir",
    args: ["-p", ...getDatasetStandardDirs(targetDatasetId)],
  })

  await writeDatasetSandboxFilesStep({
    runtime: state.runtime,
    sandboxId,
    files: [{ path: resourcePath, contentBase64: file.contentBase64 }],
  })

  const install = await runDatasetSandboxCommandStep({
    runtime: state.runtime,
    sandboxId,
    cmd: "python",
    args: ["-m", "pip", "install", "pypdf", "--quiet"],
  })
  if (install.exitCode !== 0) {
    throw new Error(`dataset_pdf_dependency_install_failed:${install.stderr || install.stdout}`)
  }

  await writeDatasetSandboxTextFilesStep({
    runtime: state.runtime,
    sandboxId,
    files: [
      {
        path: scriptPath,
        content: [
          "from pathlib import Path",
          "import json",
          "import sys",
          "from pypdf import PdfReader",
          "",
          "resource_path = Path(sys.argv[1])",
          "output_path = Path(sys.argv[2])",
          "file_id = sys.argv[3]",
          "file_name = sys.argv[4]",
          "reader = PdfReader(str(resource_path))",
          "rows = 0",
          "with output_path.open('w', encoding='utf-8') as out:",
          "    for index, page in enumerate(reader.pages, start=1):",
          "        text = page.extract_text() or ''",
          "        text = text.replace('\\x00', '').strip()",
          "        if not text:",
          "            continue",
          "        data = {",
          "            'fileId': file_id,",
          "            'fileName': file_name,",
          "            'pageNumber': index,",
          "            'text': text,",
          "        }",
          "        out.write(json.dumps({'type': 'row', 'data': data}, ensure_ascii=False) + '\\n')",
          "        rows += 1",
          "    if rows == 0:",
          "        data = {'fileId': file_id, 'fileName': file_name, 'pageNumber': 0, 'text': ''}",
          "        out.write(json.dumps({'type': 'row', 'data': data}, ensure_ascii=False) + '\\n')",
          "        rows = 1",
          "print(f'extracted_pdf_pages={len(reader.pages)} rows={rows} output={output_path}')",
          "",
        ].join("\n"),
      },
    ],
  })

  const extraction = await runDatasetSandboxCommandStep({
    runtime: state.runtime,
    sandboxId,
    cmd: "python",
    args: [scriptPath, resourcePath, outputPath, resource.fileId, fileName],
  })
  if (extraction.exitCode !== 0) {
    throw new Error(`dataset_pdf_text_extraction_failed:${extraction.stderr || extraction.stdout}`)
  }

  const output = await readDatasetSandboxTextFileStep({
    runtime: state.runtime,
    sandboxId,
    path: outputPath,
  })
  const rows = parseJsonlDataRows(output.content)
  if (rows.length === 0) {
    throw new Error("dataset_pdf_text_extraction_empty")
  }

  await materializeRowsToDataset(state.runtime, {
    datasetId: targetDatasetId,
    sandboxId,
    title: state.title ?? fileName,
    instructions: state.instructions,
    contextId: state.contextId ?? "",
    rows,
    schema: pdfTextRowsSchema(),
    first: state.first,
  })

  return targetDatasetId
}

async function writePreparedFileSourceToSandbox<Runtime extends AnyDatasetRuntime>(params: {
  runtime: Runtime
  sandboxId: string
  datasetId: string
  fileId: string
  filename?: string
}) {
  const { readInstantFileStep } = await import("../file/steps.js")
  const {
    runDatasetSandboxCommandStep,
    writeDatasetSandboxFilesStep,
  } = await import("../sandbox/steps.js")
  const file = await readInstantFileStep({ runtime: params.runtime, fileId: params.fileId })
  const contentDispositionName = parseContentDispositionFileName(file.contentDisposition)
  const fileName = sanitizeSourceFileName(
    params.filename ?? contentDispositionName,
    `${params.fileId}.bin`,
  )
  const resourcePath = `${getDatasetSourcesDir(params.datasetId)}/${fileName}`

  await runDatasetSandboxCommandStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    cmd: "mkdir",
    args: ["-p", ...getDatasetStandardDirs(params.datasetId)],
  })

  await writeDatasetSandboxFilesStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    files: [{ path: resourcePath, contentBase64: file.contentBase64 }],
  })

  return { fileName, resourcePath }
}

function resolveDatasetSandboxId<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  _targetDatasetId: string,
) {
  const sandboxId = String(state.sandboxId ?? "").trim()
  if (sandboxId) return sandboxId
  throw new Error("dataset_sandbox_id_required")
}

type PreparedFileDatasetContext = {
  kind: "file"
  datasetId: string
  sandboxId: string
  fileId: string
    sandboxState: SandboxState
    filePreview?: FilePreviewContext
    schema?: DatasetSchemaInput | null
    filename?: string
    mediaType?: string
  }

type PreparedTransformDatasetContext = {
  kind: "transform"
  datasetId: string
  sandboxId: string
  inputDatasetIds: string[]
  outputSchema: DatasetSchemaInput
  sandboxState: TransformSandboxState
  inputPreviews?: Array<{ datasetId: string; preview: TransformInputPreviewContext }>
}

type PreparedDatasetContext =
  | PreparedFileDatasetContext
  | PreparedTransformDatasetContext

type DatasetContextInitialization = PreparedDatasetContext & {
  prompt: string
  instructions?: string
}

const datasetMaterializationOutputSchema = z
  .object({
    completed: z.literal(true),
    action: z.string().optional(),
    summary: z.string().optional(),
    output: z.any().optional(),
  })
  .passthrough()

type FileMaterializationReactionContext = Omit<PreparedFileDatasetContext, "kind"> & {
  instructions: string
}

type TransformMaterializationReactionContext = Omit<PreparedTransformDatasetContext, "kind"> & {
  instructions: string
  sources: unknown[]
}

export type DatasetTriggerEventParams = {
  mode: "file" | "transform"
  prompt: string
  targetDatasetId?: string
  sourceDatasetIds?: string[]
  fileId?: string
}

export function createDatasetTriggerEvent(params: DatasetTriggerEventParams) {
  const draft = datasetDomain.events.materializationRequested({
    mode: params.mode,
    prompt: params.prompt,
  })
  return draft.link({
    ...(params.targetDatasetId
      ? { target: lookup("datasetId", params.targetDatasetId) }
      : {}),
    ...(params.sourceDatasetIds?.length
      ? {
          sources: params.sourceDatasetIds.map(
            (datasetId) => lookup("datasetId", datasetId),
          ),
        }
      : {}),
    ...(params.fileId ? { file: params.fileId } : {}),
  })
}

export async function prepareDatasetMaterializationReactionStep<
  Runtime extends AnyDatasetRuntime,
  Context,
>(params: {
  runtime: Runtime
  contextKey: string
  trigger: DatasetTriggerEventParams
  initialContext: Context
}) {
  "use step"

  const context = await ContextHandle.open<Context>(params.runtime, {
    key: params.contextKey,
    content: params.initialContext,
  })

  const triggerEvent = await context.append(createDatasetTriggerEvent(params.trigger))

  return Object.freeze({
    context: context.context,
    triggerEvent,
  })
}

export async function initializeDatasetStep<Runtime extends AnyDatasetRuntime>(params: {
  runtime: Runtime
  datasetId: string
  sandboxId: string
  title?: string
  instructions?: string
  contextId: string
  schema?: DatasetSchemaInput
}) {
  "use step"

  await createOrUpdateDatasetMetadata(params.runtime, {
    datasetId: params.datasetId,
    sandboxId: params.sandboxId,
    title: params.title ?? params.datasetId,
    instructions: params.instructions,
    contextId: params.contextId,
    schema: params.schema,
    status: "building",
  })

  return {
    datasetId: params.datasetId,
    sandboxId: params.sandboxId,
  }
}

export async function prepareDatasetSourcesStep<Runtime extends AnyDatasetRuntime>(
  params:
    | {
        kind: "file"
        runtime: Runtime
        datasetId: string
        sandboxId: string
        resource: Extract<InternalDatasetSource, { kind: "file" | "text" }>
        schema?: DatasetSchemaInput
      }
    | {
        kind: "transform"
        runtime: Runtime
        datasetId: string
        sandboxId: string
        inputDatasetIds: string[]
        outputSchema: DatasetSchemaInput
      },
): Promise<PreparedDatasetContext> {
  "use step"

  if (params.kind === "file") {
    const fileId =
      params.resource.kind === "file"
        ? params.resource.fileId
        : await uploadInlineTextSource(params.runtime, params.datasetId, params.resource)

    return {
      kind: "file",
      datasetId: params.datasetId,
      sandboxId: params.sandboxId,
      fileId,
      sandboxState: { initialized: false, filePath: "" },
      filePreview: undefined,
      schema: params.schema ?? null,
      filename: params.resource.kind === "file" ? params.resource.filename : params.resource.name,
      mediaType: params.resource.kind === "file" ? params.resource.mediaType : params.resource.mimeType,
    }
  }

  return {
    kind: "transform",
    datasetId: params.datasetId,
    sandboxId: params.sandboxId,
    inputDatasetIds: params.inputDatasetIds,
    outputSchema: params.outputSchema,
    sandboxState: { initialized: false, inputPaths: [] },
    inputPreviews: undefined,
  }
}

export async function initializeDatasetContextStep(params: {
  prepared: PreparedDatasetContext
  instructions?: string
  outputSchema?: DatasetSchemaInput
}): Promise<DatasetContextInitialization> {
  "use step"

  if (params.prepared.kind === "file") {
    return {
      ...params.prepared,
      instructions:
        params.instructions ?? buildFileDefaultInstructions(params.outputSchema),
      prompt: "generate a dataset for this file",
    }
  }

  return {
    ...params.prepared,
    instructions: params.instructions,
    prompt:
      params.prepared.inputDatasetIds.length === 1
        ? "Transform the input dataset into a new dataset matching the provided output schema"
        : `Transform ${params.prepared.inputDatasetIds.length} input datasets into a new dataset matching the provided output schema`,
  }
}

export async function completeDatasetStep<Runtime extends AnyDatasetRuntime>(params: {
  runtime: Runtime
  datasetId: string
  schema?: DatasetSchemaInput
  first: boolean
}) {
  "use step"

  let datasetResult = await datasetGetByIdStep({
    runtime: params.runtime,
    datasetId: params.datasetId,
  })
  if (!datasetResult.ok) throw new Error(datasetResult.error)

  if (!params.schema && !datasetResult.data?.schema) {
    await datasetInferAndUpdateSchemaStep({
      runtime: params.runtime,
      datasetId: params.datasetId,
      title: `${params.datasetId}Row`,
      description: "One dataset row",
    })
    datasetResult = await datasetGetByIdStep({
      runtime: params.runtime,
      datasetId: params.datasetId,
    })
    if (!datasetResult.ok) throw new Error(datasetResult.error)
  }

  const previewResult = await datasetPreviewRowsStep({
    runtime: params.runtime,
    datasetId: params.datasetId,
    limit: 20,
  })

  if (!params.first) {
    return {
      datasetId: params.datasetId,
      dataset: datasetResult.data,
      previewRows: previewResult.rows,
      firstRow: undefined,
    }
  }

  const firstResult = await datasetReadOneStep({
    runtime: params.runtime,
    datasetId: params.datasetId,
  })

  return {
    datasetId: params.datasetId,
    dataset: datasetResult.data,
    previewRows: previewResult.rows,
    firstRow: firstResult.row,
  }
}

export async function materializeSingleFileLikeSource<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  resource: Extract<InternalDatasetSource, { kind: "file" | "text" }>,
  targetDatasetId: string,
) {
  if (resource.kind === "file" && !state.outputSchema) {
    const materializedPdf = await tryMaterializeRawPdfFileSource(state, resource, targetDatasetId)
    if (materializedPdf) return materializedPdf
  }

  const sandboxId = resolveDatasetSandboxId(state, targetDatasetId)

  if (!state.engine) {
    throw new Error("dataset_engine_required")
  }

  await initializeDatasetStep({
    runtime: state.runtime,
    datasetId: targetDatasetId,
    sandboxId,
    title: state.title ?? targetDatasetId,
    instructions: state.instructions,
    contextId: state.contextId ?? "",
    schema: state.outputSchema,
  })

  const prepared = await prepareDatasetSourcesStep({
    kind: "file",
    runtime: state.runtime,
    datasetId: targetDatasetId,
    sandboxId,
    resource,
    schema: state.outputSchema,
  })
  if (prepared.kind !== "file") {
    throw new Error("dataset_context_kind_mismatch:file")
  }
  const preparedFile = await writePreparedFileSourceToSandbox({
    runtime: state.runtime,
    sandboxId,
    datasetId: targetDatasetId,
    fileId: prepared.fileId,
    filename: prepared.filename,
  })

  const context = await initializeDatasetContextStep({
    prepared: {
      ...prepared,
      filename: prepared.filename ?? preparedFile.fileName,
    },
    instructions: state.instructions,
    outputSchema: state.outputSchema,
  })
  if (context.kind !== "file") {
    throw new Error("dataset_context_kind_mismatch:file")
  }

  const initialContext: FileMaterializationReactionContext = {
    datasetId: context.datasetId,
    fileId: context.fileId,
    instructions: context.instructions ?? "",
    sandboxId: context.sandboxId,
    sandboxState: context.sandboxState,
    filePreview: context.filePreview,
    schema: context.schema,
    filename: context.filename,
    mediaType: context.mediaType,
  }
  const execution = await prepareDatasetMaterializationReactionStep({
    runtime: state.runtime,
    contextKey: `dataset:${targetDatasetId}`,
    trigger: {
      mode: "file",
      prompt: context.prompt,
      targetDatasetId,
      fileId: context.fileId,
    },
    initialContext,
  })
  const executionContext = new ContextHandle<FileMaterializationReactionContext>(
    state.runtime,
    execution.context,
  )
  const session = new Session(state.runtime, executionContext, {
    scope: datasetDomain,
    engine: state.engine,
    sandbox: sandboxId,
  })
  const sessionId = getSessionId(session)
  const input = initialContext
  const preparedEvent = await session.from(execution.triggerEvent).action(
    datasetDomain.actions.prepareFileMaterialization,
    {
      contextId: executionContext.id,
      sessionId,
      sourceEventId: execution.triggerEvent.id,
      datasetId: input.datasetId,
      fileId: input.fileId,
      sandboxId: input.sandboxId,
      instructions: input.instructions,
      sandboxState: input.sandboxState,
      filePreview: input.filePreview,
      schema: input.schema,
      filename: input.filename,
      mediaType: input.mediaType,
    },
  )
  const outputPath = (preparedEvent.payload.sandboxState as SandboxState).outputPath
  const coreActions = [
    datasetDomain.actions.executeCommand.scope({
      datasetId: input.datasetId,
      sandboxId: input.sandboxId,
      contextId: executionContext.id,
      sessionId,
    }),
    datasetDomain.actions.completeDataset.scope({
      datasetId: input.datasetId,
      sandboxId: input.sandboxId,
      outputPath,
    }),
    datasetDomain.actions.clearDataset.scope({
      datasetId: input.datasetId,
      sandboxId: input.sandboxId,
    }),
    datasetDomain.actions.defineNotation.scope({
      datasetId: input.datasetId,
    }),
  ] as const
  if (input.schema?.schema) {
    await session.from(preparedEvent).agent({
      instruction: preparedEvent.payload.instructions,
      output: datasetMaterializationOutputSchema,
      actions: coreActions,
      maxRounds: 20,
    })
  } else {
    await session.from(preparedEvent).agent({
      instruction: preparedEvent.payload.instructions,
      output: datasetMaterializationOutputSchema,
      actions: [
        ...coreActions,
        datasetDomain.actions.generateSchema.scope({
          datasetId: input.datasetId,
          fileId: input.fileId,
        }),
      ],
      maxRounds: 20,
    })
  }
  await session.complete()

  return targetDatasetId
}

export async function materializeDerivedDataset<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  targetDatasetId: string,
) {
  const sandboxId = resolveDatasetSandboxId(state, targetDatasetId)

  if (!state.engine) {
    throw new Error("dataset_engine_required")
  }

  const stateWithSandbox = { ...state, sandboxId }
  const sourceInputs = stateWithSandbox.sources
  const sources: any[] = [...(stateWithSandbox.sourceDescriptors ?? [])]

  for (let index = 0; index < sources.length; index += 1) {
    const record = sources[index] as Record<string, unknown>
    if (record.kind !== "query") continue

    const source = sourceInputs[index]
    if (!source || source.kind !== "query") {
      throw new Error(`dataset_query_source_mismatch:${String(record.key ?? index)}`)
    }

    const intermediateDatasetId = makeIntermediateDatasetId(targetDatasetId, "query", index)
    await materializeQuerySource(stateWithSandbox.runtime, source, {
      datasetId: intermediateDatasetId,
      sandboxId,
      title: source.title,
      first: false,
      contextId: stateWithSandbox.contextId ?? "",
    })

    sources[index] = {
      key: record.key,
      kind: "dataset",
      name: record.name,
      description: record.description,
      datasetId: intermediateDatasetId,
    }
  }

  const inputDatasetIds = sources.map((source, index) =>
    String((source as any).datasetId ?? source.key ?? `source_${index + 1}`),
  )
  const linkedSourceDatasetIds = sources.flatMap(source =>
    (source as any).kind === "dataset" && typeof (source as any).datasetId === "string"
      ? [(source as any).datasetId as string]
      : [],
  )

  const transformSchema =
    stateWithSandbox.outputSchema ??
    ({
      title: "DatasetRow",
      description: "One dataset row",
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {},
      },
    } satisfies DatasetSchemaInput)

  await initializeDatasetStep({
    runtime: stateWithSandbox.runtime,
    datasetId: targetDatasetId,
    sandboxId,
    title: stateWithSandbox.title ?? targetDatasetId,
    instructions: stateWithSandbox.instructions,
    contextId: stateWithSandbox.contextId ?? "",
    schema: transformSchema,
  })

  const prepared: PreparedTransformDatasetContext = {
    kind: "transform",
    datasetId: targetDatasetId,
    sandboxId,
    inputDatasetIds,
    outputSchema: transformSchema,
    sandboxState: { initialized: false, inputPaths: [] },
    inputPreviews: undefined,
  }

  const context = await initializeDatasetContextStep({
    prepared,
    instructions: buildTransformInstructions(
      inputDatasetIds.length,
      stateWithSandbox.instructions,
      stateWithSandbox.outputSchema,
    ),
    outputSchema: transformSchema,
  })
  if (context.kind !== "transform") {
    throw new Error("dataset_context_kind_mismatch:transform")
  }

  const initialContext: TransformMaterializationReactionContext = {
    datasetId: context.datasetId,
    inputDatasetIds: context.inputDatasetIds,
    outputSchema: context.outputSchema,
    instructions: context.instructions ?? "",
    sandboxId: context.sandboxId,
    sandboxState: context.sandboxState,
    inputPreviews: context.inputPreviews,
    sources,
  }
  const execution = await prepareDatasetMaterializationReactionStep({
    runtime: stateWithSandbox.runtime,
    contextKey: `dataset:${targetDatasetId}`,
    trigger: {
      mode: "transform",
      prompt: context.prompt,
      targetDatasetId,
      sourceDatasetIds: linkedSourceDatasetIds,
    },
    initialContext,
  })
  const executionContext = new ContextHandle<TransformMaterializationReactionContext>(
    stateWithSandbox.runtime,
    execution.context,
  )
  const session = new Session(stateWithSandbox.runtime, executionContext, {
    scope: datasetDomain,
    engine: state.engine,
    sandbox: sandboxId,
  })
  const sessionId = getSessionId(session)
  const input = initialContext
  const preparedMaterialization = await session.from(execution.triggerEvent).action(
    datasetDomain.actions.prepareTransformMaterialization,
    {
      datasetId: input.datasetId,
      inputDatasetIds: input.inputDatasetIds,
      outputSchema: input.outputSchema,
      instructions: input.instructions,
      sandboxId: input.sandboxId,
      sandboxState: input.sandboxState,
      inputPreviews: input.inputPreviews,
      sources: input.sources,
    },
  )
  await session.from(preparedMaterialization).agent({
    instruction: preparedMaterialization.payload.instructions,
    output: datasetMaterializationOutputSchema,
    actions: [
      datasetDomain.actions.completeObject.scope({
        datasetId: input.datasetId,
        sandboxId: input.sandboxId,
        schema: input.outputSchema,
      }),
      datasetDomain.actions.replaceRows.scope({
        datasetId: input.datasetId,
        sandboxId: input.sandboxId,
        schema: input.outputSchema,
      }),
      datasetDomain.actions.executeCommand.scope({
        datasetId: input.datasetId,
        sandboxId: input.sandboxId,
        contextId: executionContext.id,
        sessionId,
        sources: input.sources as any[],
      }),
      datasetDomain.actions.completeDataset.scope({
        datasetId: input.datasetId,
        sandboxId: input.sandboxId,
      }),
      datasetDomain.actions.clearDataset.scope({
        datasetId: input.datasetId,
        sandboxId: input.sandboxId,
      }),
      datasetDomain.actions.defineNotation.scope({
        datasetId: input.datasetId,
      }),
    ],
    maxRounds: 20,
  })
  await session.complete()

  return targetDatasetId
}

registerDatasetAgentMaterializers({
  materializeSingleFileLikeSource,
  materializeDerivedDataset,
})

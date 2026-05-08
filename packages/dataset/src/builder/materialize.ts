import { createFileParseContext } from "../file/file-dataset.agent.js"
import { readInstantFileStep } from "../file/steps.js"
import {
  generateFileParsePreviewStep,
  initializeFileParseSandboxStep,
} from "../file/file-dataset.steps.js"
import { createTransformDatasetContext } from "../transform/transform-dataset.agent.js"
import {
  ensureTransformSourcesInSandboxStep,
  generateTransformSourcePreviewsStep,
} from "../transform/transform-dataset.steps.js"
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
  buildRawSourceInstructions,
  buildTransformInstructions,
} from "./instructions.js"
import {
  createOrUpdateDatasetMetadata,
  materializeRowsToDataset,
  uploadInlineTextSource,
} from "./persistence.js"
import { getDomainDescriptor } from "./sourceRows.js"
import { materializeQuerySource } from "./materializeQuery.js"
import {
  readDatasetSandboxTextFileStep,
  runDatasetSandboxCommandStep,
  writeDatasetSandboxFilesStep,
  writeDatasetSandboxTextFilesStep,
} from "../sandbox/steps.js"
import type {
  AnyDatasetRuntime,
  DatasetBuilderState,
  DatasetSchemaInput,
  InternalSource,
} from "./types.js"
import type { SandboxState } from "../file/file-dataset.types.js"
import type { FilePreviewContext } from "../file/filepreview.types.js"
import type {
  TransformSandboxState,
  TransformSourcePreviewContext,
} from "../transform/transform-dataset.types.js"

function makeIntermediateDatasetId(targetDatasetId: string, sourceKind: string, index: number) {
  return `${targetDatasetId}__${sourceKind}_${index}`
}

function normalizeParsedTextRows(value: unknown): any[] {
  if (Array.isArray(value)) {
    return value.map((item) => (item && typeof item === "object" ? item : { value: item }))
  }
  if (value && typeof value === "object") return [value]
  return [{ value }]
}

function materializeRawTextRows(source: Extract<InternalSource, { kind: "text" }>): any[] {
  const text = String(source.text ?? "")
  const mimeType = String(source.mimeType ?? "").toLowerCase()
  const name = String(source.name ?? "").toLowerCase()
  const shouldParseJson =
    mimeType.includes("json") || name.endsWith(".json") || name.endsWith(".jsonl")

  if (shouldParseJson) {
    try {
      if (name.endsWith(".jsonl")) {
        const rows = text
          .split(/\r?\n/g)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line))
        return rows.flatMap((row) => normalizeParsedTextRows(row))
      }
      return normalizeParsedTextRows(JSON.parse(text))
    } catch {
      return [{ text }]
    }
  }

  return [{ text }]
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

function sanitizePdfFileName(value: unknown, fallback: string): string {
  const name = String(value ?? "").trim() || fallback
  const cleaned = name.replace(/[\\/:"*?<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 120)
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned || fallback}.pdf`
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
  source: Extract<InternalSource, { kind: "file" }>,
  targetDatasetId: string,
): Promise<string | null> {
  const file = await readInstantFileStep({ runtime: state.runtime, fileId: source.fileId })
  if (!isPdfContentDisposition(file.contentDisposition)) return null

  const sandboxId = resolveDatasetSandboxId(state, targetDatasetId)
  const outputPath = getDatasetOutputPath(targetDatasetId)
  const fileName = sanitizePdfFileName(
    parseContentDispositionFileName(file.contentDisposition),
    `${source.fileId}.pdf`,
  )
  const sourcePath = `${getDatasetSourcesDir(targetDatasetId)}/${fileName}`
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
    files: [{ path: sourcePath, contentBase64: file.contentBase64 }],
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
          "source_path = Path(sys.argv[1])",
          "output_path = Path(sys.argv[2])",
          "file_id = sys.argv[3]",
          "file_name = sys.argv[4]",
          "reader = PdfReader(str(source_path))",
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
    args: [scriptPath, sourcePath, outputPath, source.fileId, fileName],
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
    sources: [{ kind: "file", fileId: source.fileId, description: source.description }],
    sourceKinds: ["file"],
    rows,
    schema: pdfTextRowsSchema(),
    first: state.first,
  })

  return targetDatasetId
}

async function materializeRawTextSource<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  source: Extract<InternalSource, { kind: "text" }>,
  targetDatasetId: string,
) {
  const rows = materializeRawTextRows(source)
  await materializeRowsToDataset(state.runtime, {
    datasetId: targetDatasetId,
    sandboxId: state.sandboxId,
    title: state.title ?? source.name ?? targetDatasetId,
    instructions: state.instructions,
    sources: [
      {
        kind: "text",
        mimeType: source.mimeType,
        name: source.name,
        description: source.description,
      },
    ],
    sourceKinds: ["text"],
    rows,
    schema: state.outputSchema,
    first: state.first,
  })
  return targetDatasetId
}

function resolveDatasetSandboxId<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  _targetDatasetId: string,
) {
  const sandboxId = String(state.sandboxId ?? "").trim()
  if (sandboxId) return sandboxId

  throw new Error("dataset_sandbox_required")
}

export async function resolveDatasetAgentDurable(requestedDurable?: boolean): Promise<boolean> {
  if (!requestedDurable) return false

  try {
    const { getWorkflowMetadata } = await import("workflow")
    const workflowRunId = getWorkflowMetadata?.()?.workflowRunId
    if (workflowRunId) return false
  } catch {
    // Outside Workflow runtime there is no active metadata, so honor the caller.
  }

  return true
}

type PreparedFileDatasetContext = {
  kind: "file"
  datasetId: string
  sandboxId: string
  fileId: string
  sandboxState: SandboxState
  filePreview?: FilePreviewContext
  schema?: DatasetSchemaInput | null
}

type PreparedTransformDatasetContext = {
  kind: "transform"
  datasetId: string
  sandboxId: string
  sourceDatasetIds: string[]
  outputSchema: DatasetSchemaInput
  sandboxState: TransformSandboxState
  sourcePreviews?: Array<{ datasetId: string; preview: TransformSourcePreviewContext }>
}

type PreparedDatasetContext =
  | PreparedFileDatasetContext
  | PreparedTransformDatasetContext

type DatasetContextInitialization = PreparedDatasetContext & {
  prompt: string
  instructions?: string
}

export async function initializeDatasetStep<Runtime extends AnyDatasetRuntime>(params: {
  runtime: Runtime
  datasetId: string
  sandboxId: string
  title?: string
  instructions?: string
  sources: any[]
  sourceKinds: string[]
  schema?: DatasetSchemaInput
}) {
  "use step"

  await createOrUpdateDatasetMetadata(params.runtime, {
    datasetId: params.datasetId,
    sandboxId: params.sandboxId,
    title: params.title ?? params.datasetId,
    instructions: params.instructions,
    sources: params.sources,
    sourceKinds: params.sourceKinds,
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
        source: Extract<InternalSource, { kind: "file" | "text" }>
        schema?: DatasetSchemaInput
      }
    | {
        kind: "transform"
        runtime: Runtime
        datasetId: string
        sandboxId: string
        sourceDatasetIds: string[]
        outputSchema: DatasetSchemaInput
      },
): Promise<PreparedDatasetContext> {
  "use step"

  if (params.kind === "file") {
    const fileId =
      params.source.kind === "file"
        ? params.source.fileId
        : await uploadInlineTextSource(params.runtime, params.datasetId, params.source)

    const initialized = await initializeFileParseSandboxStep({
      runtime: params.runtime,
      sandboxId: params.sandboxId,
      datasetId: params.datasetId,
      fileId,
      state: { initialized: false, filePath: "" },
    })

    const filePreview = await generateFileParsePreviewStep({
      runtime: params.runtime,
      sandboxId: params.sandboxId,
      sandboxFilePath: initialized.filePath,
      datasetId: params.datasetId,
    })

    return {
      kind: "file",
      datasetId: params.datasetId,
      sandboxId: params.sandboxId,
      fileId,
      sandboxState: initialized.state,
      filePreview,
      schema: params.schema ?? null,
    }
  }

  const initialized = await ensureTransformSourcesInSandboxStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    datasetId: params.datasetId,
    sourceDatasetIds: params.sourceDatasetIds,
    state: { initialized: false, sourcePaths: [] },
  })

  const sourcePreviews = await generateTransformSourcePreviewsStep({
    runtime: params.runtime,
    sandboxId: params.sandboxId,
    datasetId: params.datasetId,
    sourcePaths: initialized.sourcePaths,
  })

  return {
    kind: "transform",
    datasetId: params.datasetId,
    sandboxId: params.sandboxId,
    sourceDatasetIds: params.sourceDatasetIds,
    outputSchema: params.outputSchema,
    sandboxState: initialized.state,
    sourcePreviews,
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
      params.prepared.sourceDatasetIds.length === 1
        ? "Transform the source dataset into a new dataset matching the provided output schema"
        : `Transform ${params.prepared.sourceDatasetIds.length} source datasets into a new dataset matching the provided output schema`,
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
  source: Extract<InternalSource, { kind: "file" | "text" }>,
  targetDatasetId: string,
) {
  if (source.kind === "file" && !state.outputSchema) {
    const materializedPdf = await tryMaterializeRawPdfFileSource(state, source, targetDatasetId)
    if (materializedPdf) return materializedPdf
  }

  const sandboxId = resolveDatasetSandboxId(state, targetDatasetId)

  if (!state.reactor) {
    throw new Error("dataset_reactor_required")
  }

  await initializeDatasetStep({
    runtime: state.runtime,
    datasetId: targetDatasetId,
    sandboxId,
    title: state.title ?? targetDatasetId,
    instructions: state.instructions,
    sources: [
      source.kind === "file"
        ? { kind: "file", fileId: source.fileId, description: source.description }
        : {
            kind: "text",
            mimeType: source.mimeType,
            name: source.name,
            description: source.description,
          },
    ],
    sourceKinds: [source.kind],
    schema: state.outputSchema,
  })

  const prepared = await prepareDatasetSourcesStep({
    kind: "file",
    runtime: state.runtime,
    datasetId: targetDatasetId,
    sandboxId,
    source,
    schema: state.outputSchema,
  })

  const context = await initializeDatasetContextStep({
    prepared,
    instructions: state.instructions,
    outputSchema: state.outputSchema,
  })
  if (context.kind !== "file") {
    throw new Error("dataset_context_kind_mismatch:file")
  }

  const parseContext = createFileParseContext<any>(context.fileId, {
    datasetId: context.datasetId,
    instructions: context.instructions,
    reactor: state.reactor as any,
    sandboxId: context.sandboxId,
    sandboxState: context.sandboxState,
    filePreview: context.filePreview,
    schema: context.schema,
  })

  await parseContext.parse(state.runtime as any, {
    durable: await resolveDatasetAgentDurable(state.durable),
    prompt: context.prompt,
    initialContent: {
      datasetId: context.datasetId,
      fileId: context.fileId,
      instructions: context.instructions ?? "",
      sandboxId: context.sandboxId,
      sandboxState: context.sandboxState,
      filePreview: context.filePreview,
      schema: context.schema,
    },
  })

  return targetDatasetId
}

async function normalizeSourceToDatasetId<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  source: InternalSource,
  targetDatasetId: string,
  sourceIndex: number,
) {
  if (source.kind === "dataset") {
    return source.datasetId
  }

  const intermediateDatasetId = makeIntermediateDatasetId(targetDatasetId, source.kind, sourceIndex)

  if (source.kind === "query") {
    await materializeQuerySource(state.runtime, source, {
      datasetId: intermediateDatasetId,
      sandboxId: state.sandboxId,
      title: source.title,
      first: false,
    })
    return intermediateDatasetId
  }

  if (source.kind === "text") {
    await materializeRawTextSource(
      {
        ...state,
        outputSchema: undefined,
        first: false,
        instructions: buildRawSourceInstructions(source.kind),
        title: source.name ?? state.title,
      },
      source,
      intermediateDatasetId,
    )
    return intermediateDatasetId
  }

  await materializeSingleFileLikeSource(
    {
      ...state,
      outputSchema: undefined,
      first: false,
      instructions: buildRawSourceInstructions(source.kind),
    },
    source,
    intermediateDatasetId,
  )
  return intermediateDatasetId
}

export async function materializeDerivedDataset<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  targetDatasetId: string,
) {
  if (!state.reactor) {
    throw new Error("dataset_reactor_required")
  }

  const sandboxId = resolveDatasetSandboxId(state, targetDatasetId)
  const stateWithSandbox = { ...state, sandboxId }

  const normalizedSources: string[] = []
  for (let index = 0; index < stateWithSandbox.sources.length; index++) {
    normalizedSources.push(
      await normalizeSourceToDatasetId(stateWithSandbox, stateWithSandbox.sources[index], targetDatasetId, index),
    )
  }

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
    sources: stateWithSandbox.sources.map((source) =>
      source.kind === "query"
        ? {
            kind: "query",
            query: source.query,
            title: source.title,
            explanation: source.explanation,
            ...getDomainDescriptor(source.domain),
          }
        : source,
    ),
    sourceKinds: stateWithSandbox.sources.map((source) => source.kind),
    schema: transformSchema,
  })

  const prepared = await prepareDatasetSourcesStep({
    kind: "transform",
    runtime: stateWithSandbox.runtime,
    datasetId: targetDatasetId,
    sandboxId,
    sourceDatasetIds: normalizedSources,
    outputSchema: transformSchema,
  })

  const context = await initializeDatasetContextStep({
    prepared,
    instructions: buildTransformInstructions(
      normalizedSources.length,
      stateWithSandbox.instructions,
      stateWithSandbox.outputSchema,
    ),
    outputSchema: transformSchema,
  })
  if (context.kind !== "transform") {
    throw new Error("dataset_context_kind_mismatch:transform")
  }

  const transformContext = createTransformDatasetContext<any>({
    sourceDatasetIds: context.sourceDatasetIds,
    outputSchema: context.outputSchema,
    instructions: context.instructions,
    datasetId: context.datasetId,
    reactor: stateWithSandbox.reactor as any,
    sandboxId: context.sandboxId,
    sandboxState: context.sandboxState,
    sourcePreviews: context.sourcePreviews,
  })

  await transformContext.transform(stateWithSandbox.runtime as any, {
    durable: await resolveDatasetAgentDurable(stateWithSandbox.durable),
    prompt: context.prompt,
    initialContent: {
      datasetId: context.datasetId,
      sourceDatasetIds: context.sourceDatasetIds,
      outputSchema: context.outputSchema,
      instructions: context.instructions,
      sandboxId: context.sandboxId,
      sandboxState: context.sandboxState,
      sourcePreviews: context.sourcePreviews,
    },
  })

  return targetDatasetId
}

registerDatasetAgentMaterializers({
  materializeSingleFileLikeSource,
  materializeDerivedDataset,
})

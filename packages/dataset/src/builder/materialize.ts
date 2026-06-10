import { createFileParseContext } from "../file/file-dataset.agent.js"
import { readInstantFileStep } from "../file/steps.js"
import { createTransformDatasetContext } from "../transform/transform-dataset.agent.js"
import {
  datasetGetByIdStep,
  datasetInferAndUpdateSchemaStep,
  datasetPreviewRowsStep,
  datasetReadOneStep,
} from "../dataset/steps.js"
import {
  getDatasetOutputPath,
  getDatasetScriptsDir,
  getDatasetResourcesDir,
  getDatasetStandardDirs,
} from "../datasetFiles.js"
import { registerDatasetAgentMaterializers } from "./agentMaterializers.js"
import {
  buildFileDefaultInstructions,
  buildRawResourceInstructions,
  buildTransformInstructions,
} from "./instructions.js"
import {
  createOrUpdateDatasetMetadata,
  materializeRowsToDataset,
  uploadInlineTextResource,
} from "./persistence.js"
import { materializeQueryResource } from "./materializeQuery.js"
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
  InternalDatasetResource,
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

function normalizeParsedTextRows(value: unknown): any[] {
  if (Array.isArray(value)) {
    return value.map((item) => (item && typeof item === "object" ? item : { value: item }))
  }
  if (value && typeof value === "object") return [value]
  return [{ value }]
}

function materializeRawTextRows(resource: Extract<InternalDatasetResource, { kind: "text" }>): any[] {
  const text = String(resource.text ?? "")
  const mimeType = String(resource.mimeType ?? "").toLowerCase()
  const name = String(resource.name ?? "").toLowerCase()
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

function sanitizeResourceFileName(value: unknown, fallback: string): string {
  const name = String(value ?? "").trim() || fallback
  const cleaned = name.replace(/[\\/:"*?<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 120)
  return cleaned || fallback
}

function sanitizePdfFileName(value: unknown, fallback: string): string {
  const cleaned = sanitizeResourceFileName(value, fallback)
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

async function tryMaterializeRawPdfFileResource<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  resource: Extract<InternalDatasetResource, { kind: "file" }>,
  targetDatasetId: string,
): Promise<string | null> {
  const file = await readInstantFileStep({ runtime: state.runtime, fileId: resource.fileId })
  if (!isPdfContentDisposition(file.contentDisposition)) return null

  const sandboxId = resolveDatasetSandboxId(state, targetDatasetId)
  const outputPath = getDatasetOutputPath(targetDatasetId)
  const fileName = sanitizePdfFileName(
    parseContentDispositionFileName(file.contentDisposition),
    `${resource.fileId}.pdf`,
  )
  const resourcePath = `${getDatasetResourcesDir(targetDatasetId)}/${fileName}`
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

async function materializeRawTextResource<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  resource: Extract<InternalDatasetResource, { kind: "text" }>,
  targetDatasetId: string,
) {
  const rows = materializeRawTextRows(resource)
  await materializeRowsToDataset(state.runtime, {
    datasetId: targetDatasetId,
    sandboxId: state.sandboxId,
    title: state.title ?? resource.name ?? targetDatasetId,
    instructions: state.instructions,
    contextId: state.contextId ?? "",
    rows,
    schema: state.outputSchema,
    first: state.first,
  })
  return targetDatasetId
}

async function writePreparedFileResourceToSandbox<Runtime extends AnyDatasetRuntime>(params: {
  runtime: Runtime
  sandboxId: string
  datasetId: string
  fileId: string
  filename?: string
}) {
  const file = await readInstantFileStep({ runtime: params.runtime, fileId: params.fileId })
  const contentDispositionName = parseContentDispositionFileName(file.contentDisposition)
  const fileName = sanitizeResourceFileName(
    params.filename ?? contentDispositionName,
    `${params.fileId}.bin`,
  )
  const resourcePath = `${getDatasetResourcesDir(params.datasetId)}/${fileName}`

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

export async function prepareDatasetResourcesStep<Runtime extends AnyDatasetRuntime>(
  params:
    | {
        kind: "file"
        runtime: Runtime
        datasetId: string
        sandboxId: string
        resource: Extract<InternalDatasetResource, { kind: "file" | "text" }>
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
        : await uploadInlineTextResource(params.runtime, params.datasetId, params.resource)

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

export async function materializeSingleFileLikeResource<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  resource: Extract<InternalDatasetResource, { kind: "file" | "text" }>,
  targetDatasetId: string,
) {
  if (resource.kind === "file" && !state.outputSchema) {
    const materializedPdf = await tryMaterializeRawPdfFileResource(state, resource, targetDatasetId)
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
    contextId: state.contextId ?? "",
    schema: state.outputSchema,
  })

  const prepared = await prepareDatasetResourcesStep({
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
  const preparedFile = await writePreparedFileResourceToSandbox({
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

  const parseContext = createFileParseContext<any>(context.fileId, {
    datasetId: context.datasetId,
    instructions: context.instructions,
    reactor: state.reactor as any,
    sandboxId: context.sandboxId,
    sandboxState: context.sandboxState,
    filePreview: context.filePreview,
    schema: context.schema,
    filename: context.filename,
    mediaType: context.mediaType,
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
      filename: context.filename,
      mediaType: context.mediaType,
    },
  })

  return targetDatasetId
}

async function normalizeResourceToDatasetId<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  resource: InternalDatasetResource,
  targetDatasetId: string,
  resourceIndex: number,
) {
  if (resource.kind === "dataset") {
    return resource.datasetId
  }

  const intermediateDatasetId = makeIntermediateDatasetId(targetDatasetId, resource.kind, resourceIndex)

  if (resource.kind === "query") {
    await materializeQueryResource(state.runtime, resource, {
      datasetId: intermediateDatasetId,
      sandboxId: state.sandboxId,
      title: resource.title,
      first: false,
      contextId: state.contextId ?? "",
    })
    return intermediateDatasetId
  }

  if (resource.kind === "text") {
    await materializeRawTextResource(
      {
        ...state,
        outputSchema: undefined,
        first: false,
        instructions: buildRawResourceInstructions(resource.kind),
        title: resource.name ?? state.title,
      },
      resource,
      intermediateDatasetId,
    )
    return intermediateDatasetId
  }

  if (resource.kind === "context") {
    throw new Error("dataset_context_resource_must_be_resolved_before_materialization")
  }

  await materializeSingleFileLikeResource(
    {
      ...state,
      outputSchema: undefined,
      first: false,
      instructions: buildRawResourceInstructions(resource.kind),
    },
    resource,
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

  const inputDatasetIds = (stateWithSandbox.contextResources ?? []).map((resource, index) =>
    String((resource as any).datasetId ?? resource.key ?? `resource_${index + 1}`),
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

  const transformContext = createTransformDatasetContext<any>({
    inputDatasetIds: context.inputDatasetIds,
    outputSchema: context.outputSchema,
    instructions: context.instructions,
    datasetId: context.datasetId,
    reactor: stateWithSandbox.reactor as any,
    sandboxId: context.sandboxId,
    sandboxState: context.sandboxState,
    inputPreviews: context.inputPreviews,
    contextResources: stateWithSandbox.contextResources ?? [],
  })

  await transformContext.transform(stateWithSandbox.runtime as any, {
    durable: await resolveDatasetAgentDurable(stateWithSandbox.durable),
    prompt: context.prompt,
    initialContent: {
      datasetId: context.datasetId,
      inputDatasetIds: context.inputDatasetIds,
      outputSchema: context.outputSchema,
      instructions: context.instructions,
      sandboxId: context.sandboxId,
      sandboxState: context.sandboxState,
      inputPreviews: context.inputPreviews,
      contextResources: stateWithSandbox.contextResources ?? [],
    },
  })

  return targetDatasetId
}

registerDatasetAgentMaterializers({
  materializeSingleFileLikeResource,
  materializeDerivedDataset,
})

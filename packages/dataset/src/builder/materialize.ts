import { createFileParseContext } from "../file/file-dataset.agent.js"
import { readInstantFileStep } from "../file/steps.js"
import { createTransformDatasetContext } from "../transform/transform-dataset.agent.js"
import {
  datasetInferAndUpdateSchemaStep,
  datasetReadOneStep,
} from "../dataset/steps.js"
import { getDatasetOutputPath, getDatasetWorkstation } from "../datasetFiles.js"
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
  createDatasetSandboxStep,
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

  const sandboxId = await resolveDatasetSandboxId(state, targetDatasetId)
  const workstation = getDatasetWorkstation(targetDatasetId)
  const outputPath = getDatasetOutputPath(targetDatasetId)
  const fileName = sanitizePdfFileName(
    parseContentDispositionFileName(file.contentDisposition),
    `${source.fileId}.pdf`,
  )
  const sourcePath = `${workstation}/${fileName}`
  const scriptPath = `${workstation}/extract_pdf_text.py`

  await runDatasetSandboxCommandStep({
    runtime: state.runtime,
    sandboxId,
    cmd: "mkdir",
    args: ["-p", workstation],
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

async function resolveDatasetSandboxId<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  targetDatasetId: string,
) {
  const sandboxId = String(state.sandboxId ?? "").trim()
  if (sandboxId) return sandboxId

  const created = await createDatasetSandboxStep({
    runtime: state.runtime,
    provider: "vercel",
    sandboxRuntime: "python3.13",
    timeoutMs: 20 * 60 * 1000,
    resources: { vcpus: 2 },
    purpose: "dataset.materialize",
    params: { datasetId: targetDatasetId },
    vercel: {
      profile: "ephemeral",
      deleteOnStop: true,
    },
  })
  return created.sandboxId
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

export async function materializeSingleFileLikeSource<Runtime extends AnyDatasetRuntime>(
  state: DatasetBuilderState<Runtime>,
  source: Extract<InternalSource, { kind: "file" | "text" }>,
  targetDatasetId: string,
) {
  if (source.kind === "file" && !state.outputSchema) {
    const materializedPdf = await tryMaterializeRawPdfFileSource(state, source, targetDatasetId)
    if (materializedPdf) return materializedPdf
  }

  if (!state.reactor) {
    throw new Error("dataset_reactor_required")
  }

  const sandboxId = await resolveDatasetSandboxId(state, targetDatasetId)

  const fileId =
    source.kind === "file"
      ? source.fileId
      : await uploadInlineTextSource(state.runtime, targetDatasetId, source)

  await createOrUpdateDatasetMetadata(state.runtime, {
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
    status: "building",
  })

  const parseContext = createFileParseContext<typeof state.env>(fileId, {
    datasetId: targetDatasetId,
    instructions: state.instructions ?? buildFileDefaultInstructions(state.outputSchema),
    reactor: state.reactor as any,
    sandboxId,
  })

  await parseContext.parse(state.runtime as any, {
    durable: await resolveDatasetAgentDurable(state.durable),
  })

  if (!state.outputSchema) {
    await datasetInferAndUpdateSchemaStep({
      runtime: state.runtime,
      datasetId: targetDatasetId,
      title: `${targetDatasetId}Row`,
      description: "One dataset row",
    })
  }

  if (state.first) {
    await datasetReadOneStep({ runtime: state.runtime, datasetId: targetDatasetId })
  }

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

  const sandboxId = await resolveDatasetSandboxId(state, targetDatasetId)
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

  await createOrUpdateDatasetMetadata(stateWithSandbox.runtime, {
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
    status: "building",
  })

  const transformContext = createTransformDatasetContext<typeof state.env>({
    sourceDatasetIds: normalizedSources,
    outputSchema: transformSchema,
    instructions: buildTransformInstructions(
      normalizedSources.length,
      stateWithSandbox.instructions,
      stateWithSandbox.outputSchema,
    ),
    datasetId: targetDatasetId,
    reactor: stateWithSandbox.reactor as any,
    sandboxId,
  })

  await transformContext.transform(stateWithSandbox.runtime as any, {
    durable: await resolveDatasetAgentDurable(stateWithSandbox.durable),
  })

  if (!stateWithSandbox.outputSchema) {
    await datasetInferAndUpdateSchemaStep({
      runtime: stateWithSandbox.runtime,
      datasetId: targetDatasetId,
      title: `${targetDatasetId}Row`,
      description: "One dataset row",
    })
  }

  if (stateWithSandbox.first) {
    await datasetReadOneStep({ runtime: stateWithSandbox.runtime, datasetId: targetDatasetId })
  }

  return targetDatasetId
}

registerDatasetAgentMaterializers({
  materializeSingleFileLikeSource,
  materializeDerivedDataset,
})

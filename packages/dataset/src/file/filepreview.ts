import { runDatasetSandboxCommandStep } from "../sandbox/steps.js"
import type { FilePreviewContext } from "./filepreview.types.js"
import { PYTHON_SCRIPT_BASE64_BY_NAME } from "./scripts.generated.js"

export type { FilePreviewContext } from "./filepreview.types.js"

interface PreviewOptions {
    headLines?: number
    tailLines?: number
    midLines?: number
}

const DEFAULT_HEAD_LINES = 50
const DEFAULT_TAIL_LINES = 20
const DEFAULT_MID_LINES = 20

export function getEmbeddedFilePreviewScriptBase64(scriptName: string): string {
    const embedded = PYTHON_SCRIPT_BASE64_BY_NAME[scriptName]

    if (!embedded) {
        throw new Error(`dataset_preview_script_not_embedded:${scriptName}`)
    }

    return embedded
}

function readFilePreviewScriptText(scriptName: string): string {
    return Buffer.from(getEmbeddedFilePreviewScriptBase64(scriptName), "base64").toString("utf-8")
}

type PreviewKind = "excel" | "text"

function sanitizePreviewText(value: unknown): string {
    return String(value ?? "")
        .replace(/\u0000/g, "")
        .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
}

function getPreviewKind(extension: string): PreviewKind | null {
    const normalized = extension.toLowerCase()
    if (normalized === ".xlsx" || normalized === ".xls") return "excel"
    if (
        normalized === ".csv" ||
        normalized === ".tsv" ||
        normalized === ".txt" ||
        normalized === ".log" ||
        normalized === ".json" ||
        normalized === ".jsonl" ||
        normalized === ".md"
    ) {
        return "text"
    }
    return null
}

function validateScriptResult(result: { stderr: string; stdout: string }, context: string): void
{
    if (!result.stderr)
    {
        return
    }

    const stderr = result.stderr.trim()
    if (stderr.length === 0)
    {
        return
    }

    if (stderr.includes("ModuleNotFoundError") || stderr.includes("Traceback") || stderr.includes("Error"))
    {
        throw new Error(`${context} failed: ${stderr.substring(0, 500)}`)
    }
}

export async function ensurePreviewScriptsAvailable(_runtime: any, _sandboxId: string): Promise<void> {
    return
}

export async function generateFilePreview(
    runtime: any,
    sandboxId: string,
    sandboxFilePath: string,
    datasetId: string,
    options: PreviewOptions = {}
): Promise<FilePreviewContext> {
    const context: FilePreviewContext = {
        totalRows: 0,
    }

    try {
        const metadataResult = await runScript(
            runtime,
            sandboxId,
            "file_metadata.py",
            [sandboxFilePath],
            "Extracts file metadata: name, extension, size, row count estimate, column count, and header preview"
        )
        validateScriptResult(metadataResult, `preview_metadata for ${datasetId}`)
        context.metadata = metadataResult

        let previewKind: PreviewKind | null = null
        if (metadataResult.stdout) {
            try {
                const metadataJson = JSON.parse(metadataResult.stdout)
                context.totalRows = metadataJson.row_count_estimate || 0
                const extension = metadataJson.extension || ""
                previewKind = getPreviewKind(extension)
            }
            catch {
                console.warn(`[Dataset ${datasetId}] Failed to parse metadata JSON`)
            }
        }

        const totalRows = context.totalRows
        const headLines = options.headLines || DEFAULT_HEAD_LINES
        const tailLines = options.tailLines || DEFAULT_TAIL_LINES

        if (totalRows === 0) {
            console.log(`[Dataset ${datasetId}] No rows detected, skipping preview`)
            return context
        }

        if (!previewKind) {
            console.log(`[Dataset ${datasetId}] Binary or unsupported preview format, keeping metadata only`)
            return context
        }

        const headScript = previewKind === "excel" ? "preview_head_excel.py" : "preview_head_csv.py"
        const tailScript = previewKind === "excel" ? "preview_tail_excel.py" : "preview_tail_csv.py"
        const midScript = previewKind === "excel" ? "preview_mid_excel.py" : "preview_mid_csv.py"

        if (totalRows <= headLines) {
            console.log(`[Dataset ${datasetId}] File has ${totalRows} rows, reading all with head only`)
            const headResult = await runScript(
                runtime,
                sandboxId,
                headScript,
                [sandboxFilePath, String(totalRows)],
                `Reads the first ${totalRows} rows (entire file)`
            )
            validateScriptResult(headResult, `preview_head for ${datasetId}`)
            context.head = headResult
            return context
        }

        if (headLines + tailLines >= totalRows) {
            console.log(`[Dataset ${datasetId}] Head + tail would cover entire file (${totalRows} rows), reading all with head only`)
            const headResult = await runScript(
                runtime,
                sandboxId,
                headScript,
                [sandboxFilePath, String(totalRows)],
                `Reads the first ${totalRows} rows (entire file)`
            )
            validateScriptResult(headResult, `preview_head for ${datasetId}`)
            context.head = headResult
            return context
        }

        console.log(`[Dataset ${datasetId}] Reading head (${headLines} rows) and tail (${tailLines} rows) from ${totalRows} total rows`)
        const headResult = await runScript(
            runtime,
            sandboxId,
            headScript,
            [sandboxFilePath, String(headLines)],
            `Reads the first ${headLines} rows of the file`
        )
        validateScriptResult(headResult, `preview_head for ${datasetId}`)
        context.head = headResult

        const tailResult = await runScript(
            runtime,
            sandboxId,
            tailScript,
            [sandboxFilePath, String(tailLines)],
            `Reads the last ${tailLines} rows of the file`
        )
        validateScriptResult(tailResult, `preview_tail for ${datasetId}`)
        context.tail = tailResult

        const midLines = options.midLines || DEFAULT_MID_LINES
        const gapSize = totalRows - headLines - tailLines

        if (gapSize > midLines) {
            const midStart = headLines
            const midEnd = totalRows - tailLines
            console.log(`[Dataset ${datasetId}] Large gap (${gapSize} rows), adding mid sample (${midLines} rows)`)
            const midResult = await runScript(
                runtime,
                sandboxId,
                midScript,
                [sandboxFilePath, String(midStart), String(midEnd), String(midLines)],
                `Samples ${midLines} rows from the middle section (rows ${midStart + 1} to ${midEnd})`
            )
            validateScriptResult(midResult, `preview_mid for ${datasetId}`)
            context.mid = midResult
        }

    }
    catch (error) {
        console.error(`[Dataset ${datasetId}] Error generating file preview:`, error)
        throw error
    }

    return context
}

async function runScript(
    runtime: any,
    sandboxId: string,
    scriptName: string,
    args: string[],
    description: string
): Promise<{
    description: string
    script: string
    command: string
    stdout: string
    stderr: string
}> {
    const scriptContent = readFilePreviewScriptText(scriptName)
    const command = `python -c <${scriptName}> ${args.join(" ")}`

    try {
        const result = await runDatasetSandboxCommandStep({
            runtime,
            sandboxId,
            cmd: "python",
            args: ["-c", scriptContent, ...args],
        })

        return {
            description,
            script: scriptContent,
            command,
            stdout: sanitizePreviewText(result.stdout),
            stderr: sanitizePreviewText(result.stderr),
        }
    }
    catch (error) {
        return {
            description,
            script: scriptContent,
            command,
            stdout: "",
            stderr: sanitizePreviewText(error instanceof Error ? error.message : String(error)),
        }
    }
}


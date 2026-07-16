import Ajv, { type ErrorObject, type ValidateFunction } from "ajv"
import { getDatasetOutputPath } from "./datasetFiles.js"
import { annotateNotationEvidence, type DatasetNotation } from "./notation.js"
import { DatasetService } from "./service.js"
import { getDatasetRuntimeDb } from "./dataset/steps.js"
import {
    readDatasetSandboxFileStep,
    readDatasetSandboxTextFileStep,
    runDatasetSandboxCommandStep,
} from "./sandbox/steps.js"

let ajvInstance: Ajv | null = null

function getAjv(): Ajv {
    if (!ajvInstance)
    {
        ajvInstance = new Ajv({
            allErrors: true,
            strict: false,
        })
    }
    return ajvInstance
}

export interface PersistDatasetStepParams {
    datasetId: string
    sandboxId: string
    runtime: any
    summary?: string
    outputPath?: string
}

export async function persistDatasetStep({ runtime, datasetId, sandboxId, summary, outputPath }: PersistDatasetStepParams) {
    "use step"

    const resolvedOutputPath = outputPath ?? getDatasetOutputPath(datasetId)
    const storagePath = resolveSessionStoragePath(resolvedOutputPath, datasetId)
    if (summary) {
        console.log(`[Dataset ${datasetId}] Persisting completed dataset: ${summary}`)
    }

    try {
        await ensureFileExists(runtime, sandboxId, resolvedOutputPath)
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[Dataset ${datasetId}] Missing output file:`, message)
        return {
            success: false,
            status: "missing_output",
            rowSource: "jsonl",
            validRows: 0,
            rowRecordCount: 0,
            validation: [],
            error: message,
            message,
            outputPath: resolvedOutputPath,
            storagePath,
        }
    }

    console.log(`[Dataset ${datasetId}] Validating dataset rows against schema`)

    const db = await getDatasetRuntimeDb(runtime)
    const service = new DatasetService(db)
    const datasetResult = await service.getDatasetById(datasetId)
    if (!datasetResult.ok) {
        console.error(`[Dataset ${datasetId}] ${datasetResult.error}`)
        return {
            success: false,
            status: "dataset_not_found",
            rowSource: "jsonl",
            validRows: 0,
            rowRecordCount: 0,
            validation: [],
            error: datasetResult.error,
            message: datasetResult.error,
            outputPath: resolvedOutputPath,
            storagePath,
        }
    }

    const datasetRecord = datasetResult.data
    if (!datasetRecord.schema) {
        console.error(`[Dataset ${datasetId}] Schema not found in database`)
        return {
            success: false,
            status: "schema_missing",
            rowSource: "jsonl",
            validRows: 0,
            rowRecordCount: 0,
            validation: [],
            error: "Schema not found in database. Please generate schema first.",
            message: "Schema not found in database. Please generate schema first.",
            outputPath: resolvedOutputPath,
            storagePath,
        }
    }

    const schemaJson = datasetRecord.schema.schema

    let validator: ValidateFunction
    try {
        validator = getAjv().compile(schemaJson)
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[Dataset ${datasetId}] Failed to compile schema:`, message)
        return {
            success: false,
            status: "schema_invalid",
            rowSource: "jsonl",
            validRows: 0,
            rowRecordCount: 0,
            validation: [],
            error: `Failed to compile schema: ${message}`,
            message: `Failed to compile schema: ${message}`,
            outputPath: resolvedOutputPath,
            storagePath,
        }
    }

    const validationResult = await validateJsonlRows({
        runtime,
        sandboxId,
        outputPath: resolvedOutputPath,
        validator,
        schema: schemaJson,
        datasetId,
    })

    if (!validationResult.success) {
        return {
            ...validationResult,
            rowSource: "jsonl",
            outputPath: resolvedOutputPath,
            storagePath,
        }
    }

    const totalValidRows = validationResult.validRowCount ?? 0
    const rowRecordCount = validationResult.rowRecordCount ?? totalValidRows

    console.log(`[Dataset ${datasetId}] Reading file content for upload`)
    const fileRead = await readDatasetSandboxFileStep({ runtime, sandboxId, path: resolvedOutputPath })
    if (!fileRead.contentBase64) {
        console.error(`[Dataset ${datasetId}] Empty file content`)
        return {
            success: false,
            status: "empty_output",
            rowSource: "jsonl",
            validRows: 0,
            rowRecordCount: 0,
            validation: [],
            error: "Empty file content",
            message: "Empty file content",
            outputPath: resolvedOutputPath,
            storagePath,
        }
    }

    console.log(`[Dataset ${datasetId}] Uploading file to InstantDB storage`)

    const uploadResult = await service.uploadDatasetOutputFile({
        datasetId,
        fileBuffer: Buffer.from(fileRead.contentBase64, "base64"),
        storagePath,
    })

    if (!uploadResult.ok) {
        console.error(`[Dataset ${datasetId}] File upload failed: ${uploadResult.error}`)
        return {
            success: false,
            status: "upload_failed",
            rowSource: "jsonl",
            validRows: totalValidRows,
            rowRecordCount,
            validation: validationResult.validation,
            error: uploadResult.error,
            message: uploadResult.error,
            outputPath: resolvedOutputPath,
            storagePath,
        }
    }

    console.log(`[Dataset ${datasetId}] File uploaded successfully: ${uploadResult.data.fileId}`)

    const statusResult = await service.updateDatasetStatus({
        datasetId,
        status: "completed",
        calculatedTotalRows: totalValidRows,
        actualGeneratedRowCount: totalValidRows,
    } as any)

    if (!statusResult.ok) {
        console.error(`[Dataset ${datasetId}] Failed to update status: ${statusResult.error}`)
        return {
            success: false,
            status: "status_update_failed",
            rowSource: "jsonl",
            validRows: totalValidRows,
            rowRecordCount,
            validation: validationResult.validation,
            error: statusResult.error,
            message: statusResult.error,
            outputPath: resolvedOutputPath,
            storagePath,
            dataFileId: uploadResult.data.fileId,
        }
    }

    console.log(`[Dataset ${datasetId}] Dataset marked as COMPLETED (${totalValidRows} valid rows)`)
    console.log(`[Dataset ${datasetId}] ========================================`)

    // Formal-notation evidence: advisory arithmetic annotation of the latest
    // notation against the produced rows. Informative only — it never
    // affects the dataset completion result or the dataset's validity.
    try {
        await annotateNotationFromJsonl({
            service,
            datasetId,
            jsonlBase64: fileRead.contentBase64,
        })
    }
    catch (error) {
        console.error(
            `[Dataset ${datasetId}] notation annotation skipped:`,
            error instanceof Error ? error.message : String(error),
        )
    }

        return {
            success: true,
            status: "completed",
            rowSource: "jsonl",
            records: totalValidRows,
            summary: summary ?? `Dataset completed with ${totalValidRows} records.`,
            outputPath: resolvedOutputPath,
            storagePath,
            dataFileId: uploadResult.data.fileId,
        }
}

const NOTATION_EVIDENCE_MAX_ROWS = 50_000

async function annotateNotationFromJsonl(params: {
    service: DatasetService
    datasetId: string
    jsonlBase64: string
}): Promise<void> {
    const existing = await params.service.getDatasetById(params.datasetId)
    const notation = (existing.ok ? existing.data?.notation : null) as DatasetNotation | null
    if (!notation || !Array.isArray(notation.predicates) || notation.predicates.length === 0) {
        return
    }

    const rows: any[] = []
    const content = Buffer.from(params.jsonlBase64, "base64").toString("utf-8")
    for (const line of content.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
            const parsed = JSON.parse(trimmed)
            if (parsed && parsed.type === "row") {
                rows.push(parsed.data)
            }
        }
        catch {
            // malformed lines were already handled by schema validation
        }
        if (rows.length >= NOTATION_EVIDENCE_MAX_ROWS) break
    }

    const annotated = annotateNotationEvidence(notation, rows)
    await params.service.updateDatasetNotation({
        datasetId: params.datasetId,
        notation: annotated,
    })
    const contradicted = (annotated.checks ?? []).filter(
        (check) => check.status === "contradicted",
    )
    console.log(
        `[Dataset ${params.datasetId}] notation v${annotated.version} (${annotated.status})` +
        (contradicted.length
            ? ` — ${contradicted.length} predicado(s) con evidencia contraria (advisory)`
            : ""),
    )
}

function resolveSessionStoragePath(outputPath: string, datasetId: string): string {
    const normalized = String(outputPath ?? "").replace(/\\/g, "/")
    const marker = "/tmp/ekairos/contexts/"
    if (normalized.startsWith(marker)) {
        return normalized.slice("/tmp/ekairos".length)
    }
    return `/dataset/${datasetId}/output.jsonl`
}

async function ensureFileExists(runtime: any, sandboxId: string, path: string): Promise<void> {
    const result = await runDatasetSandboxCommandStep({
        runtime,
        sandboxId,
        cmd: "test",
        args: ["-f", path],
    })

    if (result.exitCode !== 0) {
        throw new Error(`Required file not found: ${path}`)
    }
}

interface ValidateJsonlRowsParams {
    runtime: any
    sandboxId: string
    outputPath: string
    validator: ValidateFunction
    schema: unknown
    datasetId: string
}

type RowValidationEntry = {
    index: number
    valid: boolean
    errors?: string[]
    errorDetails?: Array<{
        path: string
        keyword: string
        message: string
        params?: Record<string, unknown>
        schemaPath?: string
    }>
    dataKeys?: string[]
}

type ValidationFailureSummary = {
    rowRecordCount: number
    validRowCount: number
    invalidRowCount: number
    expectedTopLevelKeys: string[]
    requiredTopLevelKeys: string[]
    requiredPaths: string[]
    enumConstraints: Array<{ path: string; values: unknown[] }>
    topErrors: Array<{ message: string; count: number }>
    missingRequiredProperties: Array<{ property: string; count: number }>
    additionalProperties: Array<{ property: string; count: number }>
    enumFailures: Array<{ path: string; allowedValues: unknown[]; count: number }>
    observedTopLevelKeys: string[]
    sampleInvalidRows: Array<{
        index: number
        dataKeys?: string[]
        errors?: string[]
    }>
}

function asRecord(value: unknown): Record<string, any> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, any>
        : null
}

function joinSchemaPath(basePath: string, key: string): string {
    return basePath === "$" ? `$.${key}` : `${basePath}.${key}`
}

function collectRequiredPaths(schema: unknown, path = "$", paths: string[] = []): string[] {
    const record = asRecord(schema)
    if (!record) return paths

    const properties = asRecord(record.properties)
    if (properties) {
        const required = Array.isArray(record.required)
            ? record.required.filter((value): value is string => typeof value === "string")
            : []
        for (const key of required) {
            paths.push(joinSchemaPath(path, key))
        }
        for (const [key, childSchema] of Object.entries(properties)) {
            collectRequiredPaths(childSchema, joinSchemaPath(path, key), paths)
        }
    }

    if (record.items) {
        collectRequiredPaths(record.items, `${path}[]`, paths)
    }

    for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
        if (Array.isArray(record[keyword])) {
            for (const childSchema of record[keyword]) {
                collectRequiredPaths(childSchema, path, paths)
            }
        }
    }

    return [...new Set(paths)]
}

function collectEnumConstraints(schema: unknown, path = "$", constraints: Array<{ path: string; values: unknown[] }> = []): Array<{ path: string; values: unknown[] }> {
    const record = asRecord(schema)
    if (!record) return constraints

    if (Array.isArray(record.enum)) {
        constraints.push({ path, values: record.enum })
    }

    const properties = asRecord(record.properties)
    if (properties) {
        for (const [key, childSchema] of Object.entries(properties)) {
            collectEnumConstraints(childSchema, joinSchemaPath(path, key), constraints)
        }
    }

    if (record.items) {
        collectEnumConstraints(record.items, `${path}[]`, constraints)
    }

    for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
        if (Array.isArray(record[keyword])) {
            for (const childSchema of record[keyword]) {
                collectEnumConstraints(childSchema, path, constraints)
            }
        }
    }

    return constraints
}

function countValues(values: string[], maxItems = 20): Array<{ value: string; count: number }> {
    const counts = new Map<string, number>()
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, maxItems)
        .map(([value, count]) => ({ value, count }))
}

function toErrorDetails(errors: ErrorObject[] | null | undefined): NonNullable<RowValidationEntry["errorDetails"]> {
    if (!Array.isArray(errors)) return []
    return errors.map((err) => ({
        path: err.instancePath || "$",
        keyword: err.keyword,
        message: err.message || "Unknown validation error",
        params: asRecord(err.params) ?? undefined,
        schemaPath: err.schemaPath,
    }))
}

function buildValidationFailureSummary(params: {
    schema: unknown
    validation: RowValidationEntry[]
    rowRecordCount: number
    validRowCount: number
}): ValidationFailureSummary {
    const rootSchema = asRecord(params.schema)
    const rootProperties = asRecord(rootSchema?.properties)
    const invalidRows = params.validation.filter((entry) => !entry.valid)
    const errorMessages = invalidRows.flatMap((entry) => entry.errors ?? [])
    const observedTopLevelKeys = [
        ...new Set(invalidRows.flatMap((entry) => entry.dataKeys ?? [])),
    ].sort((a, b) => a.localeCompare(b))

    const details = invalidRows.flatMap((entry) => entry.errorDetails ?? [])
    const missingRequiredProperties = countValues(
        details
            .filter((detail) => detail.keyword === "required")
            .map((detail) => String(detail.params?.missingProperty ?? "unknown")),
    ).map(({ value, count }) => ({ property: value, count }))

    const additionalProperties = countValues(
        details
            .filter((detail) => detail.keyword === "additionalProperties")
            .map((detail) => String(detail.params?.additionalProperty ?? "unknown")),
    ).map(({ value, count }) => ({ property: value, count }))

    const enumFailureCounts = new Map<string, {
        path: string
        allowedValues: unknown[]
        count: number
    }>()
    for (const detail of details.filter((entry) => entry.keyword === "enum")) {
        const key = `${detail.path}:${JSON.stringify(detail.params?.allowedValues ?? [])}`
        const current = enumFailureCounts.get(key)
        enumFailureCounts.set(key, {
            path: detail.path,
            allowedValues: Array.isArray(detail.params?.allowedValues)
                ? detail.params.allowedValues
                : [],
            count: (current?.count ?? 0) + 1,
        })
    }

    return {
        rowRecordCount: params.rowRecordCount,
        validRowCount: params.validRowCount,
        invalidRowCount: invalidRows.length,
        expectedTopLevelKeys: rootProperties ? Object.keys(rootProperties) : [],
        requiredTopLevelKeys: Array.isArray(rootSchema?.required)
            ? rootSchema.required.filter((value): value is string => typeof value === "string")
            : [],
        requiredPaths: collectRequiredPaths(params.schema).slice(0, 120),
        enumConstraints: collectEnumConstraints(params.schema).slice(0, 80),
        topErrors: countValues(errorMessages, 20).map(({ value, count }) => ({
            message: value,
            count,
        })),
        missingRequiredProperties,
        additionalProperties,
        enumFailures: [...enumFailureCounts.values()]
            .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
            .slice(0, 20),
        observedTopLevelKeys,
        sampleInvalidRows: invalidRows.slice(0, 10).map((entry) => ({
            index: entry.index,
            dataKeys: entry.dataKeys,
            errors: entry.errors?.slice(0, 12),
        })),
    }
}

function buildRepairInstructions(summary: ValidationFailureSummary): string[] {
    const instructions = [
        "Rewrite output.jsonl using the schema as the authority. Do not use input file headers as JSON keys unless they exactly match schema property names.",
        "Each non-empty line must be a JSON object shaped as {\"type\":\"row\",\"data\":{...}}.",
        "Populate every required top-level and nested required path from failureSummary.requiredPaths.",
        "For enum fields, emit exactly one allowed literal from failureSummary.enumConstraints or failureSummary.enumFailures.",
    ]

    if (summary.validRowCount === 0 && summary.rowRecordCount > 0) {
        instructions.unshift("All produced row records failed validation; treat the previous output as structurally invalid and regenerate it from scratch.")
    }

    if (summary.additionalProperties.length > 0) {
        instructions.push("Remove unexpected data keys listed in failureSummary.additionalProperties; map their values into schema keys instead.")
    }

    if (summary.missingRequiredProperties.length > 0) {
        instructions.push("Add the missing required properties listed in failureSummary.missingRequiredProperties to each affected row.")
    }

    return instructions
}

function validationOutputSample(validation: RowValidationEntry[]): {
    validation: RowValidationEntry[]
    validationTruncated: number
} {
    const maxEntries = 50
    const invalidRows = validation.filter((entry) => !entry.valid)
    const sampleSource = invalidRows.length > 0 ? invalidRows : validation
    return {
        validation: sampleSource.slice(0, maxEntries),
        validationTruncated: Math.max(0, sampleSource.length - maxEntries),
    }
}

async function validateJsonlRows({ runtime, sandboxId, outputPath, validator, schema, datasetId }: ValidateJsonlRowsParams): Promise<{
    success: boolean
    validation?: RowValidationEntry[]
    validationTruncated?: number
    failureSummary?: ValidationFailureSummary
    repairInstructions?: string[]
    validRowCount?: number
    rowRecordCount?: number
    error?: string
    status?: string
    message?: string
}> {
    const validation: RowValidationEntry[] = []
    let validRowCount = 0
    let rowRecordCount = 0

    console.log(`[Dataset ${datasetId}] Reading and validating JSONL file from sandbox`)

    const fileRead = await readDatasetSandboxTextFileStep({ runtime, sandboxId, path: outputPath })
    if (!fileRead.content) {
        console.log(`[Dataset ${datasetId}] Empty output file`)
        return {
            success: false,
            status: "empty_output",
            validation,
            validRowCount: 0,
            rowRecordCount: 0,
            error: "output.jsonl is empty",
            message: "output.jsonl is empty",
        }
    }

    const lines = fileRead.content.split("\n")
    console.log(`[Dataset ${datasetId}] Validating ${lines.length} lines`)

    for (let index = 0; index < lines.length; index++)
    {
        const line = lines[index]
        const trimmed = line.trim()
        if (trimmed.length === 0) {
            continue
        }

        let record: any
        try {
            record = JSON.parse(trimmed)
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            validation.push({
                index,
                valid: false,
                errors: [`Invalid JSON: ${message}`],
            })
            continue
        }

        if (record.type !== "row") {
            validation.push({
                index,
                valid: false,
                errors: ["Every non-empty output line must be a JSON object with type 'row'"],
            })
            continue
        }

        rowRecordCount++
        const data = record.data
        if (data === undefined || data === null) {
            validation.push({
                index,
                valid: false,
                errors: ["Missing 'data' field"],
            })
            continue
        }

        const valid = validator(data)
        if (!valid) {
            const errorDetails = toErrorDetails(validator.errors)
            const errors = errorDetails.length > 0
                ? errorDetails.map((err) => err.message || "Unknown validation error")
                : ["Unknown validation error"]
            validation.push({
                index,
                valid: false,
                errors,
                errorDetails,
                dataKeys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [],
            })
            continue
        }

        validation.push({
            index,
            valid: true,
        })
        validRowCount++
    }

    console.log(`[Dataset ${datasetId}] Validation completed: ${validRowCount} valid rows`)

    const invalidRows = validation.filter((entry) => !entry.valid)
    if (rowRecordCount === 0 || validRowCount === 0 || invalidRows.length > 0) {
        const failureSummary = buildValidationFailureSummary({
            schema,
            validation,
            rowRecordCount,
            validRowCount,
        })
        const repairInstructions = buildRepairInstructions(failureSummary)
        const sampled = validationOutputSample(validation)
        const message =
            rowRecordCount === 0
                ? "output.jsonl does not contain any type='row' records"
                : validRowCount === 0
                    ? "No dataset rows matched the stored schema"
                    : `${invalidRows.length} dataset row(s) failed schema validation`
        console.error(`[Dataset ${datasetId}] Validation failed: ${message}`)
        return {
            success: false,
            status: "validation_failed",
            validation: sampled.validation,
            validationTruncated: sampled.validationTruncated,
            failureSummary,
            repairInstructions,
            validRowCount,
            rowRecordCount,
            error: message,
            message: `${message}. Repair output.jsonl using repairInstructions and failureSummary.`,
        }
    }

    return {
        success: true,
        status: "completed",
        validation,
        validRowCount,
        rowRecordCount,
    }
}

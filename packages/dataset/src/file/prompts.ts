// Plain build API using template literals and XML

import { create } from "xmlbuilder2"
import type { FileParseContext } from "./file-dataset.types.js"
import type { FilePreviewContext } from "./filepreview.types.js"
import { getDatasetWorkstation, getDatasetOutputPath } from "../datasetFiles.js"

function buildRole(): string {
    let xml = create()
        .ele("Role")
        .txt("You are a dataset creator for a SINGLE file. Your goal is to convert the file content into a validated JSONL dataset where each line represents one record.")
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildGoal(): string {
    let xml = create()
        .ele("Goal")
        .txt("Convert the input file into a validated JSONL dataset (output.jsonl) where each line is a JSON object conforming to a generated schema. The schema describes ONE data record structure. Extract ONLY data records; exclude any header sections, metadata, or summary information from the file.")
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildResourceInfo(context: FileParseContext): any {
    let xml = create()
        .ele("FileResource")
        .ele("Type").txt("file").up()
        .ele("FileId").txt(context.fileId).up()
        .ele("DatasetId").txt(context.datasetId).up()
        .ele("FilePath").txt(context.sandboxConfig.filePath).up()
        .up()

    return xml
}

function buildFilePreviewSection(preview: FilePreviewContext): any {
    let xml = create()
        .ele("FilePreview")
        .ele("TotalRows").txt(String(preview.totalRows)).up()

    if (preview.metadata) {
        xml = xml.ele("Metadata")
            .ele("Description").txt(preview.metadata.description).up()

        if (preview.metadata.script) {
            xml = xml.ele("Script").txt(preview.metadata.script).up()
        }

        xml = xml.ele("Command").txt(preview.metadata.command).up()
            .ele("Stdout").txt(preview.metadata.stdout).up()

        if (preview.metadata.stderr && preview.metadata.stderr.trim().length > 0) {
            xml = xml.ele("Stderr").txt(preview.metadata.stderr).up()
        }

        xml = xml.up()
    }

    if (preview.head) {
        xml = xml.ele("Head")
            .ele("Description").txt(preview.head.description).up()

        if (preview.head.script) {
            xml = xml.ele("Script").txt(preview.head.script).up()
        }

        xml = xml.ele("Command").txt(preview.head.command).up()
            .ele("Stdout").txt(preview.head.stdout).up()

        if (preview.head.stderr && preview.head.stderr.trim().length > 0) {
            xml = xml.ele("Stderr").txt(preview.head.stderr).up()
        }

        xml = xml.up()
    }

    if (preview.tail) {
        xml = xml.ele("Tail")
            .ele("Description").txt(preview.tail.description).up()

        if (preview.tail.script) {
            xml = xml.ele("Script").txt(preview.tail.script).up()
        }

        xml = xml.ele("Command").txt(preview.tail.command).up()
            .ele("Stdout").txt(preview.tail.stdout).up()

        if (preview.tail.stderr && preview.tail.stderr.trim().length > 0) {
            xml = xml.ele("Stderr").txt(preview.tail.stderr).up()
        }

        xml = xml.up()
    }

    if (preview.mid) {
        xml = xml.ele("Mid")
            .ele("Description").txt(preview.mid.description).up()

        if (preview.mid.script) {
            xml = xml.ele("Script").txt(preview.mid.script).up()
        }

        xml = xml.ele("Command").txt(preview.mid.command).up()
            .ele("Stdout").txt(preview.mid.stdout).up()

        if (preview.mid.stderr && preview.mid.stderr.trim().length > 0) {
            xml = xml.ele("Stderr").txt(preview.mid.stderr).up()
        }

        xml = xml.up()
    }

    xml = xml.up()
    return xml
}

function buildErrorsSection(errors: string[]): any | null {
    if (errors.length === 0) {
        return null
    }

    let xml = create()
        .ele("PreviousErrors")
        .ele("Instruction").txt("Treat these as repair feedback from the previous validation attempt. Rewrite output.jsonl from the schema contract; do not patch input column names into schema keys piecemeal.").up()

    for (const error of errors) {
        xml = xml.ele("Error").txt(error).up()
    }

    xml = xml.up()
    return xml
}

function buildContextSection(context: FileParseContext): string {
    let xml = create()
        .ele("Context")

    const resourceXml = buildResourceInfo(context)
    xml = xml.import(resourceXml.first())

    if (context.filePreview) {
        const previewXml = buildFilePreviewSection(context.filePreview)
        xml = xml.import(previewXml.first())
    }

    if (context.errors.length > 0) {
        const errorsXml = buildErrorsSection(context.errors)
        if (errorsXml) {
            xml = xml.import(errorsXml.first())
        }
    }

    xml = xml.up()

    return xml.end({ prettyPrint: true, headless: true })
}

type SchemaContract = {
    requiredPaths: string[]
    propertyPaths: string[]
    enumConstraints: Array<{ path: string; values: string[] }>
    closedObjectPaths: string[]
}

function asRecord(value: unknown): Record<string, any> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, any>
        : null
}

function getSchemaObject(context: FileParseContext): Record<string, any> | null {
    return asRecord(context.schema?.schema)
}

function joinSchemaPath(basePath: string, key: string): string {
    return basePath === "$" ? `$.${key}` : `${basePath}.${key}`
}

function collectSchemaContract(schema: unknown, path = "$", contract: SchemaContract = {
    requiredPaths: [],
    propertyPaths: [],
    enumConstraints: [],
    closedObjectPaths: [],
}): SchemaContract {
    const record = asRecord(schema)
    if (!record) {
        return contract
    }

    if (Array.isArray(record.enum)) {
        contract.enumConstraints.push({
            path,
            values: record.enum.map((value) => JSON.stringify(value)),
        })
    }

    const properties = asRecord(record.properties)
    if (properties) {
        if (record.additionalProperties === false) {
            contract.closedObjectPaths.push(path)
        }

        const required = Array.isArray(record.required)
            ? record.required.filter((value): value is string => typeof value === "string")
            : []
        for (const key of required) {
            contract.requiredPaths.push(joinSchemaPath(path, key))
        }

        for (const [key, childSchema] of Object.entries(properties)) {
            const childPath = joinSchemaPath(path, key)
            contract.propertyPaths.push(childPath)
            collectSchemaContract(childSchema, childPath, contract)
        }
    }

    if (record.items) {
        collectSchemaContract(record.items, `${path}[]`, contract)
    }

    for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
        if (Array.isArray(record[keyword])) {
            for (const childSchema of record[keyword]) {
                collectSchemaContract(childSchema, path, contract)
            }
        }
    }

    return contract
}

function appendLimitedList(
    xml: any,
    elementName: string,
    itemName: string,
    values: string[],
    maxItems: number,
): any {
    let node = xml.ele(elementName)
    for (const value of values.slice(0, maxItems)) {
        node = node.ele(itemName).txt(value).up()
    }
    if (values.length > maxItems) {
        node = node.ele("Truncated").txt(String(values.length - maxItems)).up()
    }
    return node.up()
}

function buildSchemaSection(context: FileParseContext): string {
    const schema = getSchemaObject(context)
    if (!context.schema || !schema) {
        return ""
    }

    const contract = collectSchemaContract(schema)
    let xml = create()
        .com("Schema section: This defines the structure of ONE RECORD (row). Each line in the JSONL output must conform to this schema.")
        .ele("Schema")
        .ele("Title").txt(context.schema.title || "").up()
        .ele("Description").txt(context.schema.description || "").up()

    xml = xml
        .ele("SchemaContract")
        .ele("Purpose").txt("Compact output contract derived from JSON Schema. Use this before writing output.jsonl.").up()
        .ele("Rule").txt("Use only schema property keys in data objects. Input headers are input labels, not output keys.").up()
        .ele("Rule").txt("Required paths are required everywhere, including nested objects and array items.").up()
        .ele("Rule").txt("Enum fields must use exactly one of the listed literal values. Normalize input labels to the closest valid enum literal; never emit a value outside the enum.").up()

    xml = appendLimitedList(xml, "RequiredPaths", "Path", contract.requiredPaths, 120)
    xml = appendLimitedList(xml, "PropertyPaths", "Path", contract.propertyPaths, 160)

    let enumsXml = xml.ele("EnumConstraints")
    for (const constraint of contract.enumConstraints.slice(0, 80)) {
        let enumXml = enumsXml.ele("Enum", { path: constraint.path })
        for (const value of constraint.values.slice(0, 80)) {
            enumXml = enumXml.ele("Value").txt(value).up()
        }
        if (constraint.values.length > 80) {
            enumXml = enumXml.ele("Truncated").txt(String(constraint.values.length - 80)).up()
        }
        enumsXml = enumXml.up()
    }
    if (contract.enumConstraints.length > 80) {
        enumsXml = enumsXml.ele("Truncated").txt(String(contract.enumConstraints.length - 80)).up()
    }
    xml = enumsXml.up()
    xml = appendLimitedList(xml, "ClosedObjectPaths", "Path", contract.closedObjectPaths, 80)

    xml = xml
        .up()
        .ele("JsonSchema").txt(JSON.stringify(schema, null, 2)).up()
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildInstructions(context: FileParseContext): string {
    const datasetWorkstation = context.sandboxConfig.scriptsDir
        ? context.sandboxConfig.scriptsDir.replace(/\/scripts$/, "")
        : getDatasetWorkstation(context.datasetId)
    const outputPath = context.sandboxConfig.outputPath ?? getDatasetOutputPath(context.datasetId)
    const hasProvidedSchema = Boolean(context.schema?.schema)
    const currentTask = hasProvidedSchema
        ? "Review FilePreview section, use the provided schema as the output contract, then parse the file and generate the dataset"
        : "Review FilePreview section to understand file structure, then generate JSON Schema for a SINGLE RECORD, then parse the file and generate the dataset"

    let xml = create()
        .ele("Instructions")
        .ele("Workflow")
        .ele("Step", { number: "1", name: "Inspect File" })
        .ele("Action").txt("Review the FilePreview section in Context to understand the file structure").up()
        .ele("Note").txt("FilePreview contains: TotalRows (total data rows), Metadata (file properties with JSON output), Head (first N raw file lines), Tail (last N lines if present), Mid (middle sample for large files). Each section shows Description, Script (full Python code), Command, Stdout (raw content), Stderr. This allows you to understand the exact file format.").up()
        .up()
    xml = xml
        .ele("Step", { number: "2", name: "Propose Formal Notation (PLAN FIRST)" })
        .ele("Action").txt("Call proposeNotation with the INITIAL formal definition of the dataset as a set, derived from the file preview: D = { r | r ∈ File ∧ <constraints> } in LaTeX, the symbols it binds (sets, variables, functions) and the predicates every row will satisfy").up()
        .ele("Requirements")
        .ele("Requirement").txt("The notation is your PLANNING artifact: it comes BEFORE the schema and BEFORE any parsing code. The LaTeX that explains the dataset matters more than the code that produces it").up()
        .ele("Requirement").txt("Use set-builder notation, quantifiers and arithmetic in LaTeX (e.g. D = \\{(c, q, p) \\mid q \\in \\mathbb{Z}^{+},\\; p \\in \\mathbb{R}_{\\geq 0}\\})").up()
        .ele("Requirement").txt("Declare every discovered set and variable as a symbol with a one-line meaning").up()
        .ele("Requirement").txt("Give predicates a machine-checkable checkJson whenever the claim is arithmetic (row counts, field types, ranges, uniqueness, aggregates); leave semantic-only claims without checkJson").up()
        .ele("Requirement").txt("ITERATE: every time the analysis discovers a new set, variable, constraint or correction (new columns, unexpected types, excluded sections), call proposeNotation again with the refined notation and the reason. The notation is not definitive — discovery is the point").up()
        .ele("Requirement").txt("Before calling completeDataset, call proposeNotation one last time with final=true so the notation describes EXACTLY the dataset you produced; its checkable predicates will be verified arithmetically against the rows").up()
        .up()
        .up()

    if (hasProvidedSchema) {
        xml = xml
            .ele("Step", { number: "3", name: "Use Provided Schema" })
            .ele("Action").txt("Use the provided schema as the output contract for every row in output.jsonl").up()
            .ele("Requirements")
            .ele("Requirement").txt("Every output row must conform exactly to the provided schema").up()
            .ele("Requirement").txt("Every data object MUST use the exact property names from the provided JSON Schema required/properties keys").up()
            .ele("Requirement").txt("Build a schema-first mapping from input columns to schema fields before writing output.jsonl. Do not use raw input headers as JSON keys unless they are exactly schema keys").up()
            .ele("Requirement").txt("For nested required fields, populate the required child keys inside each nested object or array item; top-level validity is not enough").up()
            .ele("Requirement").txt("For enum fields, emit exactly one allowed enum literal from SchemaContract; normalize labels or abbreviations into allowed literals").up()
            .ele("Requirement").txt("Do not translate, localize, rename, camelize differently, or infer alternative field names. Field names are a technical contract; only field values may preserve the input language").up()
            .ele("Requirement").txt("Do not call generateSchema when a schema is already provided").up()
            .up()
            .up()
    } else {
        xml = xml
            .ele("Step", { number: "3", name: "Generate JSON Schema" })
            .ele("Action").txt("Call generateSchema to create a JSON Schema for a SINGLE DATA RECORD (one row of data)").up()
            .ele("Requirements")
            .ele("Requirement").txt("Schema describes ONE DATA RECORD structure only (type: object, not array)").up()
            .ele("Requirement").txt("Schema represents data records ONLY, not header sections or metadata").up()
            .ele("Requirement").txt("All property names must be lowercaseCamelCase").up()
            .ele("Requirement").txt("Include all data columns/fields from records, exclude header fields").up()
            .ele("Requirement").txt("Define correct data types for each field").up()
            .up()
            .up()
    }

    xml = xml
        .ele("Step", { number: "4", name: "Generate Dataset JSONL" })
        .ele("Action").txt(`Use executeCommand to parse the file and generate output.jsonl in the dataset workstation`).up()
        .ele("Requirements")
        .ele("Requirement").txt("Parse ALL data rows/records from the file (exclude header sections and metadata)").up()
        .ele("Requirement").txt("Output JSONL format: each line is {\"type\": \"row\", \"data\": {...record...}}").up()
        .ele("Requirement").txt("When a schema is provided, each data object must contain the exact required schema keys and must not use translated or synonymous keys").up()
        .ele("Requirement").txt("When validation returns zero valid rows, treat the previous output as structurally wrong and rewrite output.jsonl from the SchemaContract, not by applying small patches").up()
        .ele("Requirement").txt("Extract ONLY data records; skip any header lines, summary sections, or file metadata").up()
        .ele("Requirement").txt(`Save output to: ${outputPath}`).up()
        .ele("Requirement").txt("Use descriptive scriptName in snake_case (e.g., 'parse_csv_to_jsonl')").up()
        .up()
        .up()
        .ele("Step", { number: "5", name: "Complete and Validate" })
        .ele("Action").txt("Call proposeNotation with final=true (refined to match the produced rows), then call completeDataset to validate the dataset").up()
        .ele("Behavior").txt("Validates that output.jsonl exists and all records conform to the schema stored in database. Returns success:false with validation details if validation fails. If validation fails, inspect validation errors, rewrite output.jsonl, and call completeDataset again. Do not stop until completeDataset returns success:true.").up()
        .up()
        .up()
        .ele("Rules")
        .ele("Rule").txt("The formal notation (proposeNotation) is the planning artifact: propose it first, iterate it on every discovery, finalize it before completion. The LaTeX explains the dataset; the code merely produces it").up()
        .ele("Rule").txt("Schema defines ONE DATA RECORD structure (not array, not header)").up()
        .ele("Rule").txt("Schema property names are authoritative. Never translate or rename keys such as itemName, quantity, or unit into the input language").up()
        .ele("Rule").txt("Original/input language applies to extracted values only, not to JSON object keys").up()
        .ele("Rule").txt("Datasets contain ONLY data records; exclude all header sections and file metadata").up()
        .ele("Rule").txt("JSONL format: each line = separate JSON object representing one data record").up()
        .ele("Rule").txt("FilePreview shows raw file content - use Script to understand data extraction").up()
        .ele("Rule").txt("Use executeCommand for parsing and file generation").up()
        .ele("Rule").txt(`Each dataset has its own isolated workstation: ${datasetWorkstation}`).up()
        .ele("Rule").txt(`Required output: ${outputPath}`).up()
        .ele("Rule").txt("Schema is stored in database (dataset_datasets table), not in files").up()
        .up()
        .ele("CurrentTask").txt(currentTask).up()
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

export function buildFileDatasetPrompt(context: FileParseContext): string {
    const sections: string[] = []

    sections.push(buildRole())
    sections.push("")
    sections.push(buildGoal())
    sections.push("")
    sections.push(buildContextSection(context))
    sections.push("")
    const schemaSection = buildSchemaSection(context)
    if (schemaSection) {
        sections.push(schemaSection)
        sections.push("")
    }
    sections.push(buildInstructions(context))

    return sections.join("\n")
}


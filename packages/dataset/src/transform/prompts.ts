import { create } from "xmlbuilder2"
import type { TransformPromptContext } from "./transform-dataset.types.js"

function buildRole(): string {
    let xml = create()
        .ele("Role")
        .txt("You are a dataset transformer. Read the declared sources and produce a new dataset whose records conform exactly to the output schema.")
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildGoal(): string {
    let xml = create()
        .ele("Goal")
        .txt("Transform the sources into a dataset strictly matching the output schema. Use direct completion when possible and sandbox execution only for necessary deterministic inspection or computation.")
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildContextSection(context: TransformPromptContext): string {
    let xml = create()
        .ele("Context")
        .ele("DatasetId").txt(context.datasetId).up()

    if (context.sources && context.sources.length > 0) {
        let sourcesXml = create().ele("Sources")
        for (const source of context.sources) {
            sourcesXml = sourcesXml
                .ele("Source")
                .ele("Key").txt(String(source.key)).up()
                .ele("Kind").txt(String(source.kind)).up()
                .ele("Name").txt(String(source.name)).up()
                .ele("Description").txt(String(source.description)).up()
                .ele("DescriptorJson").txt(JSON.stringify(source, null, 2)).up()
                .up()
        }
        xml = xml.import(sourcesXml.first())
    }

    let sandboxXml = create().ele("Sandbox")
    sandboxXml = sandboxXml.ele("SourcesPath").txt("/tmp/ekairos/contexts/{contextId}/sources").up()
    sandboxXml = sandboxXml.ele("SourcesManifest").txt("/tmp/ekairos/contexts/{contextId}/sources/manifest.json").up()
    sandboxXml = sandboxXml.ele("OutputPath").txt(context.sandboxConfig.outputPath).up()
    sandboxXml = sandboxXml.ele("Note").txt("Sources are materialized only when executeCommand runs. Read os.environ['EKAIROS_DATASET_SOURCES_MANIFEST'] inside Python.").up()
    xml = xml.import(sandboxXml.first())

    if (context.inputPreviews && context.inputPreviews.length > 0) {
        let previewsXml = create().ele("InputPreviews")
        for (const inputPreviewInfo of context.inputPreviews) {
            const sp = inputPreviewInfo.preview
            let px = create().ele("InputPreview")
                .ele("DatasetId").txt(inputPreviewInfo.datasetId).up()
                .ele("TotalRows").txt(String(sp.totalRows)).up()

            if (sp.metadata) {
                const m = sp.metadata
                px = px.ele("Metadata")
                    .ele("Description").txt(m.description).up()
                    .ele("Script").txt(m.script).up()
                    .ele("Command").txt(m.command).up()
                    .ele("Stdout").txt(m.stdout).up()
                if (m.stderr && m.stderr.trim().length > 0) {
                    px = px.ele("Stderr").txt(m.stderr).up()
                }
                px = px.up()
            }

            if (sp.head) {
                const h = sp.head
                px = px.ele("Head")
                    .ele("Description").txt(h.description).up()
                    .ele("Script").txt(h.script).up()
                    .ele("Command").txt(h.command).up()
                    .ele("Stdout").txt(h.stdout).up()
                if (h.stderr && h.stderr.trim().length > 0) {
                    px = px.ele("Stderr").txt(h.stderr).up()
                }
                px = px.up()
            }

            px = px.up()
            previewsXml = previewsXml.import(px.first())
        }
        xml = xml.import(previewsXml.first())
    }

    if (Array.isArray(context.errors) && context.errors.length > 0) {
        let ex = create().ele("PreviousErrors")
        for (const e of context.errors) {
            ex = ex.ele("Error").txt(e).up()
        }
        xml = xml.import(ex.first())
    }

    xml = xml.up()
    return xml.end({ prettyPrint: true, headless: true })
}

function buildOutputSchemaSection(context: TransformPromptContext): string {
    let xml = create()
        .ele("OutputSchema")
        .ele("JsonSchema").txt(JSON.stringify(context.outputSchema?.schema ?? context.outputSchema ?? {}, null, 2)).up()
        .up()
    return xml.end({ prettyPrint: true, headless: true })
}

function buildInstructions(context: TransformPromptContext): string {
    const outputPath = context.sandboxConfig.outputPath
    const multipleInputsNote = (context.sources?.length ?? context.inputDatasetIds.length) > 1
        ? "Multiple sources are available; join, filter, or combine them when required by the output definition."
        : ""

    let xml = create()
        .ele("Instructions")
        .ele("Workflow")
        .ele("Step", { number: "1", name: "Inspect Inputs" })
        .ele("Action").txt(`Review Sources and InputPreviews to understand structures, evidence, fields and edge cases. ${multipleInputsNote}`).up()
        .ele("Note").txt("DescriptorJson may include inline text or previews. Treat visible evidence as already available; do not execute a command only to reread it.").up()
        .up()
        .ele("Step", { number: "2", name: "Define the Output Dataset (PLAN FIRST)" })
        .ele("Action").txt("Call defineNotation with the formal definition of the OUTPUT dataset as a set derived from the input sets: e.g. D = \\pi_{fields}(\\sigma_{condition}(A \\bowtie B)) or set-builder with quantifiers, in LaTeX. Declare the input sets, bound variables and the predicates the output set satisfies.").up()
        .ele("Note").txt("The definition and the materialization (the transform code + output rows) are TWO CO-EQUAL FACES of the dataset; author the definition FIRST as the PLAN: it states which sets you draw from, how they combine (join, filter, project, aggregate) and which invariants the output keeps (e.g. totals preserved). The definition is a formal proposition we trust — predicates may be semantic. Only for purely arithmetic invariants you MAY add a checkJson for optional advisory evidence. REFINE the definition whenever inspection of the inputs reveals new sets, variables or corrections, and call defineNotation with final=true just before completing — as the RESULT it describes the produced output; any arithmetic predicates then get advisory evidence (never a verdict).").up()
        .up()
        .ele("Step", { number: "3", name: "Plan Mapping" })
        .ele("Action").txt("Plan a deterministic mapping from input data fields to the output schema fields (normalize names, types, and formats).").up()
        .ele("Note").txt("If fields are missing, set defaults; if types differ, coerce consistently. When working with multiple inputs, decide how to combine or relate them. Output field names must remain exactly as declared by the output schema.").up()
        .up()
        .ele("Step", { number: "4", name: "Transform" })
        .ele("Action").txt("For single-object output, use completeObject with the final object. For row output, use replaceRows with the final rows. Use executeCommand only when command execution is necessary, not merely convenient.").up()
        .ele("Requirement").txt("Do not call completeObject until you have constructed the complete data object. completeObject requires data; a summary-only call is invalid and wastes a model iteration.").up()
        .ele("Requirement").txt("Command execution is necessary only when the output requires deterministic inspection, parsing, aggregation, joins, or computation over source files.").up()
        .ele("Requirement").txt("If the final output can be written directly from context already visible to you, do not use executeCommand. Do not use executeCommand just to format JSON, build an object, write output.jsonl, or make completion easier.").up()
        .ele("Requirement").txt("Before using executeCommand, verify that visible descriptors and previews are insufficient or deterministic computation is required.").up()
        .ele("Requirement").txt("commandDescription must identify the sources, operation, expected output, and why execution is required.").up()
        .ele("Requirement").txt("executeCommand materializes sources at /tmp/ekairos/contexts/{contextId}/sources and provides EKAIROS_DATASET_SOURCES_DIR plus EKAIROS_DATASET_SOURCES_MANIFEST.").up()
        .ele("Requirement").txt("Pass sourceKeys when only a subset of sources is needed.").up()
        .ele("Requirement").txt(`If executeCommand is used, write file to: ${outputPath}`).up()
        .ele("Requirement").txt("Every data object MUST use the exact property names from OutputSchema required/properties keys. Do not translate, localize, rename, or infer alternative field names.").up()
        .ele("Requirement").txt("Do not print large data to stdout; only progress and summaries.").up()
        .ele("Requirement").txt("Do not install packages, download dependencies, or access the network from executeCommand. Use only the available runtime and standard library unless a dependency is already present.").up()
        .up()
        .ele("Step", { number: "5", name: "Validate and Complete" })
        .ele("Action").txt("Call defineNotation with final=true (the definition as RESULT, matching the produced output), then: when using completeObject or replaceRows, no separate completeDataset call is needed. When using executeCommand, call completeDataset to validate against the output schema and mark as completed.").up()
        .ele("Behavior").txt("If any completion tool returns success:false, inspect validation details, repair the output, and call the appropriate completion tool again. Do not stop until a completion tool returns success:true.").up()
        .up()
        .up()
        .ele("Rules")
        .ele("Rule").txt("The formal definition (defineNotation) and the materialization (transform code + output rows) are co-equal faces of the dataset: author the definition first as the PLAN, refine it on every discovery, finalize it as the RESULT before completing.").up()
        .ele("Rule").txt("Output must strictly match the output schema for each record in data.").up()
        .ele("Rule").txt("OutputSchema property names are authoritative. Field names are a technical contract; only field values may preserve input language.").up()
        .ele("Rule").txt("Use the cheapest correct tool. completeObject and replaceRows are low-cost completion tools. executeCommand is a high-cost computation tool and requires an explicit commandDescription.").up()
        .ele("Rule").txt("If using output.jsonl, each line must be a standalone JSON object with {type:'row', data:{...}}.").up()
        .ele("Rule").txt("Do not include headers, summaries, or metadata as records.").up()
        .ele("Rule").txt("Be robust to malformed lines in input: skip or sanitize, but do not crash.").up()
        .up()
        .ele("CurrentTask").txt("Transform input dataset(s) to match OutputSchema and complete the dataset with the appropriate available tool.").up()
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

export function buildTransformDatasetPrompt(context: TransformPromptContext): string {
    const sections: string[] = []
    sections.push(buildRole())
    sections.push("")
    sections.push(buildGoal())
    sections.push("")
    sections.push(buildContextSection(context))
    sections.push("")
    sections.push(buildOutputSchemaSection(context))
    sections.push("")
    sections.push(buildInstructions(context))
    return sections.join("\n")
}



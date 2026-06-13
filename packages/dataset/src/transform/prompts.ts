import { create } from "xmlbuilder2"
import type { TransformPromptContext } from "./transform-dataset.types.js"

function buildRole(): string {
    let xml = create()
        .ele("Role")
        .txt("You are a dataset transformer. Your goal is to read one or more input datasets/resources and produce a NEW dataset whose records conform exactly to the provided output schema.")
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildGoal(): string {
    let xml = create()
        .ele("Goal")
        .txt("Transform the input dataset(s) into a new dataset strictly matching the output schema. Use the lowest-cost direct completion tool that can produce the correct output. Use sandbox command execution only when commands are necessary to inspect, parse, aggregate, join, or compute over files/resources that cannot be handled directly from the visible context and previews.")
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildContextSection(context: TransformPromptContext): string {
    let xml = create()
        .ele("Context")
        .ele("DatasetId").txt(context.datasetId).up()

    if (context.contextResources && context.contextResources.length > 0) {
        let resourcesXml = create().ele("ContextResources")
        for (const resource of context.contextResources) {
            resourcesXml = resourcesXml
                .ele("Resource")
                .ele("Key").txt(String(resource.key)).up()
                .ele("Type").txt(String(resource.type)).up()
                .ele("Name").txt(String(resource.name)).up()
                .ele("Description").txt(String(resource.description)).up()
                .ele("DescriptorJson").txt(JSON.stringify(resource, null, 2)).up()
                .up()
        }
        xml = xml.import(resourcesXml.first())
    }

    let sandboxXml = create().ele("Sandbox")
    sandboxXml = sandboxXml.ele("ContextResourcesPath").txt("/tmp/ekairos/contexts/{contextId}/resources").up()
    sandboxXml = sandboxXml.ele("ResourcesManifest").txt("/tmp/ekairos/contexts/{contextId}/resources/manifest.json").up()
    sandboxXml = sandboxXml.ele("OutputPath").txt(context.sandboxConfig.outputPath).up()
    sandboxXml = sandboxXml.ele("Note").txt("Context resources are materialized lazily only when executeCommand is called. Do not assume resource files exist unless you are using executeCommand. If executeCommand is used, read the manifest path from os.environ['EKAIROS_CONTEXT_RESOURCES_MANIFEST'] inside Python.").up()
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
    const multipleInputsNote = (context.contextResources?.length ?? context.inputDatasetIds.length) > 1
        ? "You have multiple context resources available. You may need to read, join, filter, or combine data from them to produce the output."
        : ""

    let xml = create()
        .ele("Instructions")
        .ele("Workflow")
        .ele("Step", { number: "1", name: "Inspect Inputs" })
        .ele("Action").txt(`Review ContextResources and any InputPreviews to understand current record structures, evidence, fields, shapes and edge cases. ${multipleInputsNote}`).up()
        .ele("Note").txt("ContextResources DescriptorJson may include inline text, metadata, previewRows, or other visible evidence. Treat that visible content as already available context. Do not use executeCommand only to reread it.").up()
        .up()
        .ele("Step", { number: "2", name: "Propose Formal Notation (PLAN FIRST)" })
        .ele("Action").txt("Call proposeNotation with the formal definition of the OUTPUT dataset as a set derived from the input sets: e.g. D = \\pi_{fields}(\\sigma_{condition}(A \\bowtie B)) or set-builder with quantifiers, in LaTeX. Declare the input sets, bound variables and the predicates every output row satisfies.").up()
        .ele("Note").txt("The notation is the planning artifact and comes BEFORE the transformation: it states which sets you draw from, how they combine (join, filter, project, aggregate) and which arithmetic invariants the output keeps (e.g. totals preserved across the transformation). Give predicates a machine-checkable checkJson whenever the claim is arithmetic (row counts, ranges, uniqueness, aggregates). ITERATE the notation whenever inspection of the inputs reveals new sets, variables or corrections, and call proposeNotation with final=true just before completing — it will be verified arithmetically against the produced rows.").up()
        .up()
        .ele("Step", { number: "3", name: "Plan Mapping" })
        .ele("Action").txt("Plan a deterministic mapping from input data fields to the output schema fields (normalize names, types, and formats).").up()
        .ele("Note").txt("If fields are missing, set defaults; if types differ, coerce consistently. When working with multiple inputs, decide how to combine or relate them. Output field names must remain exactly as declared by the output schema.").up()
        .up()
        .ele("Step", { number: "4", name: "Transform" })
        .ele("Action").txt("For single-object output, use completeObject with the final object. For row output, use replaceRows with the final rows. Use executeCommand only when command execution is necessary, not merely convenient.").up()
        .ele("Requirement").txt("Do not call completeObject until you have constructed the complete data object. completeObject requires data; a summary-only call is invalid and wastes a model iteration.").up()
        .ele("Requirement").txt("Command execution is necessary only when the final output cannot be produced directly from the provided context, resource descriptors, or previews, and requires running code to inspect, parse, aggregate, join, or compute over files/resources.").up()
        .ele("Requirement").txt("If the final output can be written directly from context already visible to you, do not use executeCommand. Do not use executeCommand just to format JSON, build an object, write output.jsonl, or make completion easier.").up()
        .ele("Requirement").txt("Before using executeCommand, verify that direct completion is insufficient: you need file/resource contents not already visible in DescriptorJson or previews, deterministic computation over many rows, parsing/aggregation that is unreliable to do directly, or output too large/repetitive for direct completion. If none apply, command execution is not needed.").up()
        .ele("Requirement").txt("When using executeCommand, provide commandDescription before the script runs. It must describe the inputs/resources used, operation performed, expected output, and why a command is the right tool.").up()
        .ele("Requirement").txt("When executeCommand is used, context resources are materialized before the script runs at /tmp/ekairos/contexts/{contextId}/resources. The Python process receives EKAIROS_CONTEXT_RESOURCES_DIR and EKAIROS_CONTEXT_RESOURCES_MANIFEST environment variables. Read os.environ['EKAIROS_CONTEXT_RESOURCES_MANIFEST'] inside the script to discover exact files and metadata. Manifest entries expose files as resource['files'][index]['path'].").up()
        .ele("Requirement").txt("If only some resources are needed for a command, pass resourceKeys with the specific ContextResources keys. Omit resourceKeys only when the script truly needs all resources.").up()
        .ele("Requirement").txt(`If executeCommand is used, write file to: ${outputPath}`).up()
        .ele("Requirement").txt("Every data object MUST use the exact property names from OutputSchema required/properties keys. Do not translate, localize, rename, or infer alternative field names.").up()
        .ele("Requirement").txt("Do not print large data to stdout; only progress and summaries.").up()
        .ele("Requirement").txt("Do not install packages, download dependencies, or access the network from executeCommand. Use only the available runtime and standard library unless a dependency is already present.").up()
        .up()
        .ele("Step", { number: "5", name: "Validate and Complete" })
        .ele("Action").txt("Call proposeNotation with final=true (refined to match the produced output), then: when using completeObject or replaceRows, no separate completeDataset call is needed. When using executeCommand, call completeDataset to validate against the output schema and mark as completed.").up()
        .ele("Behavior").txt("If any completion tool returns success:false, inspect validation details, repair the output, and call the appropriate completion tool again. Do not stop until a completion tool returns success:true.").up()
        .up()
        .up()
        .ele("Rules")
        .ele("Rule").txt("The formal notation (proposeNotation) is the planning artifact: propose it before transforming, iterate it on every discovery, finalize it before completing. The LaTeX explains the dataset; the code merely produces it.").up()
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



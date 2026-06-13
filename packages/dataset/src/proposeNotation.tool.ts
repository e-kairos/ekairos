import { tool } from "ai"
import { z } from "zod"
import { DatasetService } from "./service.js"
import { datasetDomain } from "./schema.js"
import {
  reviseDatasetNotation,
  type DatasetNotation,
  type DatasetNotationPredicate,
  type DatasetNotationSymbol,
  type NotationCheck,
} from "./notation.js"

interface ProposeNotationToolParams {
  datasetId: string
  runtime: any
}

const symbolSchema = z.object({
  name: z.string().describe("Plain identifier, e.g. 'D', 'Orders', 'w'"),
  latex: z
    .string()
    .optional()
    .describe("LaTeX for the symbol, e.g. '\\\\mathcal{D}' (defaults to the name)"),
  kind: z.enum(["set", "variable", "function", "constant", "predicate"]),
  description: z.string().describe("What this symbol denotes in the data"),
})

const predicateSchema = z.object({
  id: z.string().describe("Stable id, e.g. 'p1', 'cardinality'"),
  description: z.string().describe("The claim in plain language"),
  latex: z
    .string()
    .describe("The claim in LaTeX, e.g. '\\\\forall r \\\\in D: r.amount > 0'"),
  checkJson: z
    .string()
    .optional()
    .describe(
      [
        "OPTIONAL arithmetic form of the claim as a JSON string, used only for",
        "advisory evidence over the produced rows (not a verdict). Shapes:",
        '{"kind":"row_count","op":"=","value":124}',
        '{"kind":"field_type","field":"amount","type":"number","allowNull":true}',
        '{"kind":"field_range","field":"amount","min":0}',
        '{"kind":"field_in","field":"status","values":["paid","void"]}',
        '{"kind":"field_nonnull","field":"orderId"}',
        '{"kind":"field_matches","field":"sku","pattern":"^[A-Z0-9-]+$"}',
        '{"kind":"unique","fields":["orderId"]}',
        '{"kind":"aggregate","fn":"sum","field":"amount","op":">=","value":0}',
        'Propositional composition: {"kind":"and"|"or","checks":[...]},',
        '{"kind":"not","check":...}, {"kind":"implies","if":...,"then":...}.',
        "Fields support dot-paths into nested records (company.taxId).",
        "Omit for formal/semantic claims (the normal case) — they are trusted.",
      ].join(" "),
    ),
})

async function getDatasetService(runtime: any): Promise<DatasetService> {
  const scoped = await runtime.use(datasetDomain)
  return new DatasetService(scoped.db as any)
}

/**
 * proposeNotation — declare or ITERATE the formal notation of the dataset.
 *
 * The notation is the planning artifact: call it FIRST with the initial
 * set definition derived from the resources, and call it AGAIN whenever
 * the analysis discovers new sets, variables, constraints or corrections.
 * Every call appends a revision (the discovery trail is preserved). Mark
 * the last call with final=true so the notation describes the produced
 * dataset. Predicates may be formal/semantic (we trust them); the few that
 * are arithmetic get optional advisory evidence after completion.
 */
export function createProposeNotationTool({ datasetId, runtime }: ProposeNotationToolParams) {
  return tool({
    description: [
      "Declare or refine the FORMAL NOTATION of the dataset: the dataset as a",
      "set defined in LaTeX (set-builder, relational algebra, quantified or",
      "even semantic predicates) plus the symbols it binds. The definition is",
      "a logical proposition, possibly derived — it does not need to be",
      "mechanically provable; we trust the formality. This is your PLANNING",
      "artifact — propose it before writing any code, and revise it whenever",
      "the analysis discovers new sets, variables or constraints. For the few",
      "predicates that happen to be arithmetic you MAY attach a checkJson for",
      "optional advisory evidence (non-blocking, never a verdict).",
    ].join(" "),
    inputSchema: z.object({
      latex: z
        .string()
        .describe(
          "Main definition of the dataset as a set, in LaTeX. Example: 'D = \\\\{(w,r,t) \\\\mid t = \\\\sum_{o \\\\in Orders} o.amount,\\\\; o.status = paid\\\\}'",
        ),
      symbols: z.array(symbolSchema).describe("Symbols bound by the notation"),
      predicates: z
        .array(predicateSchema)
        .describe("Claims about the dataset; include machine-checkable forms when possible"),
      reason: z
        .string()
        .describe("What discovery triggered this revision (or 'initial proposal')"),
      final: z
        .boolean()
        .optional()
        .describe("true when this notation describes the dataset you are about to complete"),
    }),
    execute: async ({ latex, symbols, predicates, reason, final }) => {
      try {
        const service = await getDatasetService(runtime)
        const existing = await service.getDatasetById(datasetId)
        const previous = (existing.ok ? existing.data?.notation : null) as
          | DatasetNotation
          | null

        const parsedPredicates: DatasetNotationPredicate[] = []
        const checkErrors: string[] = []
        for (const predicate of predicates) {
          let check: NotationCheck | undefined
          if (predicate.checkJson) {
            try {
              check = JSON.parse(predicate.checkJson) as NotationCheck
              if (!check || typeof check !== "object" || !("kind" in check)) {
                throw new Error("check must be an object with a 'kind'")
              }
            } catch (error) {
              checkErrors.push(
                `predicate ${predicate.id}: invalid checkJson (${String(error).slice(0, 80)})`,
              )
              check = undefined
            }
          }
          parsedPredicates.push({
            id: predicate.id,
            description: predicate.description,
            latex: predicate.latex,
            ...(check ? { check } : {}),
          })
        }

        const notation = reviseDatasetNotation(previous, {
          latex,
          symbols: symbols as DatasetNotationSymbol[],
          predicates: parsedPredicates,
          reason,
          final,
        })

        const update = await service.updateDatasetNotation({ datasetId, notation })
        if (!update.ok) {
          return { success: false, error: update.error }
        }

        console.log(
          `[Dataset ${datasetId}] notation v${notation.version} (${notation.status}): ${reason}`,
        )

        return {
          success: true,
          version: notation.version,
          status: notation.status,
          ...(checkErrors.length
            ? {
                warning: `some checks were dropped: ${checkErrors.join("; ")}`,
              }
            : {}),
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  })
}

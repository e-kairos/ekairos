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

interface DefineNotationToolParams {
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
 * defineNotation — author or REFINE the formal DEFINITION of the dataset.
 *
 * A dataset has two co-equal faces: its formal definition (the notation —
 * the proposition that defines the set, in LaTeX) and its materialization
 * (the rows + the code that produces them). They sit at the SAME level: the
 * definition is not a side note about the data, it IS the dataset stated
 * intensionally. The same notation is the PLAN (you state it first and the
 * materialization realizes it) and, finalized, the RESULT (it describes what
 * you produced).
 *
 * Call it FIRST with the initial definition derived from the resources, and
 * AGAIN whenever the analysis discovers new sets, variables, constraints or
 * corrections — every call keeps the prior version in history. Mark the last
 * call with final=true so the definition describes the produced dataset.
 * Predicates may be formal/semantic (trusted); the few that are arithmetic
 * MAY carry optional advisory evidence.
 */
export function createDefineNotationTool({ datasetId, runtime }: DefineNotationToolParams) {
  return tool({
    description: [
      "Author or refine the formal DEFINITION of the dataset: the dataset as a",
      "set in LaTeX (set-builder, relational algebra, quantified or even",
      "semantic predicates) plus the symbols it binds. This definition and the",
      "materialization (rows + code) are TWO CO-EQUAL FACES of the dataset —",
      "the definition is the dataset stated intensionally, not a comment on it.",
      "It is your PLAN (state it before writing any code; the materialization",
      "realizes it) and, once final, the RESULT (it describes what you",
      "produced). The definition is a logical proposition, possibly derived —",
      "it need not be mechanically provable; we trust the formality. State it",
      "first, refine it on every discovery, and set final=true on the last",
      "call. For the few predicates that are arithmetic you MAY attach a",
      "checkJson for optional advisory evidence (non-blocking, never a verdict).",
    ].join(" "),
    inputSchema: z.object({
      latex: z
        .string()
        .describe(
          "Main definition of the dataset as a set, in LaTeX. Example: 'D = \\\\{(w,r,t) \\\\mid t = \\\\sum_{o \\\\in Orders} o.amount,\\\\; o.status = paid\\\\}'",
        ),
      symbols: z.array(symbolSchema).describe("Symbols bound by the definition"),
      predicates: z
        .array(predicateSchema)
        .describe("Claims the set satisfies; attach a checkJson only when arithmetic"),
      reason: z
        .string()
        .describe("What this revision states or what discovery triggered it (or 'initial definition')"),
      final: z
        .boolean()
        .optional()
        .describe("true when this definition describes the dataset you are about to complete (the RESULT)"),
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
          `[Dataset ${datasetId}] definition v${notation.version} (${notation.status}): ${reason}`,
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

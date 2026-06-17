/**
 * Formal notation for datasets — the dataset stated intensionally.
 *
 * A dataset has TWO CO-EQUAL FACES at the same level:
 * - its formal DEFINITION (this notation: the proposition that defines the
 *   set, in LaTeX), and
 * - its MATERIALIZATION (the rows + the code that produces them).
 * The notation is not a comment about the data; it IS the dataset, written
 * as a logical statement. The materialization is the same set written
 * extensionally. Neither is subordinate to the other.
 *
 * The SAME notation plays two roles across the lifecycle: it is the PLAN
 * (status "plan": stated first, the materialization is built to realize it)
 * and, once finalized, the RESULT (status "result": it describes exactly
 * what was produced). It is iterated in between — every revision keeps the
 * prior version in `history`, so the discovery trail stays visible.
 *
 * The definition is a logical proposition, possibly DERIVED (a syllogism),
 * so it is NOT, in general, mechanically verifiable: a predicate may be
 * semantic ("x es una frase divertida") and the set is still well-formed.
 * We TRUST the formality and the produced dataset — there is no verdict.
 *
 * SOME predicates happen to be arithmetic (a row count, a field type, a
 * preserved total). For those, and only those, we attach OPTIONAL evidence
 * computed over the rows. It is advisory: a contradiction is a hint, never
 * a claim that the dataset is invalid. Predicates with no arithmetic form
 * are "asserted" — trusted. Nothing here blocks or changes a build; the
 * notation rides on dataset_datasets.notation.
 */

/* ── types ──────────────────────────────────────────────────────── */

export type DatasetNotationSymbolKind =
  | "set"
  | "variable"
  | "function"
  | "constant"
  | "predicate"

export type DatasetNotationSymbol = {
  /** plain identifier, e.g. "D", "w", "Orders" */
  name: string
  /** LaTeX for the symbol, e.g. "\\mathcal{D}" (defaults to the name) */
  latex?: string
  kind: DatasetNotationSymbolKind
  description: string
}

export type NotationCmpOp = "=" | "!=" | "<" | "<=" | ">" | ">="

/**
 * OPTIONAL arithmetic evidence for the subset of predicates that happen to
 * be mechanical (counts, types, ranges, totals). Evaluated over the rows;
 * field access supports dot-paths into nested records ("company.taxId").
 * Leaf checks are dataset-level propositions; and/or/not/implies compose
 * them propositionally. A predicate WITHOUT a check is a formal/semantic
 * claim we trust — that is the normal case, not an exception.
 */
export type NotationCheck =
  | { kind: "row_count"; op: NotationCmpOp; value: number }
  | {
      kind: "field_type"
      field: string
      type: "number" | "integer" | "string" | "boolean"
      allowNull?: boolean
    }
  | { kind: "field_range"; field: string; min?: number; max?: number }
  | { kind: "field_in"; field: string; values: Array<string | number | boolean> }
  | { kind: "field_nonnull"; field: string }
  | { kind: "field_matches"; field: string; pattern: string }
  | { kind: "unique"; fields: string[] }
  | {
      kind: "aggregate"
      fn: "sum" | "count" | "min" | "max" | "avg"
      /** omit for fn = "count" */
      field?: string
      op: NotationCmpOp
      value: number
      /** absolute tolerance for float comparison (default 1e-9) */
      tolerance?: number
    }
  | { kind: "and"; checks: NotationCheck[] }
  | { kind: "or"; checks: NotationCheck[] }
  | { kind: "not"; check: NotationCheck }
  | { kind: "implies"; if: NotationCheck; then: NotationCheck }

export type DatasetNotationPredicate = {
  /** stable id within the notation, e.g. "p1", "rowCount" */
  id: string
  description: string
  /** the claim in LaTeX, e.g. "\\forall r \\in D:\\; r.amount > 0" */
  latex: string
  /**
   * OPTIONAL arithmetic form. Absent (the common case) = a formal/semantic
   * claim we trust without mechanical checking.
   */
  check?: NotationCheck
}

/**
 * Advisory evidence for one predicate. Never a verdict on the dataset:
 * - "asserted"     formal/semantic claim, trusted, no mechanical check
 * - "supported"    arithmetic evidence agrees with the stated claim
 * - "contradicted" arithmetic evidence disagrees — a hint, not a failure
 */
export type DatasetNotationCheckResult = {
  predicateId: string
  status: "asserted" | "supported" | "contradicted"
  detail?: string
}

export type DatasetNotationRevision = {
  version: number
  latex: string
  /** why this revision happened — the discovery that triggered it */
  reason: string
  at: number
}

/**
 * The role the notation currently plays — the two ends of its life:
 * - "plan":   stated before/while building; the materialization realizes it
 * - "result": finalized; it describes the dataset that was produced
 * There is intentionally NO "verified"/"violated" verdict — validity is
 * trusted, not proven. Iteration is tracked by `version`/`history`; advisory
 * arithmetic evidence lives in `checks`, separate from this role.
 */
export type DatasetNotationStatus = "plan" | "result"

export type DatasetNotation = {
  version: number
  status: DatasetNotationStatus
  /** the main definition: the dataset as a set, in LaTeX */
  latex: string
  symbols: DatasetNotationSymbol[]
  predicates: DatasetNotationPredicate[]
  /** advisory per-predicate evidence (asserted/supported/contradicted) */
  checks?: DatasetNotationCheckResult[]
  /** when the advisory evidence was last computed */
  evidenceAt?: number
  history: DatasetNotationRevision[]
}

/* ── construction / iteration ───────────────────────────────────── */

export type NotationRevisionInput = {
  latex: string
  symbols?: DatasetNotationSymbol[]
  predicates?: DatasetNotationPredicate[]
  reason: string
  /** "final" marks the notation as describing the produced dataset */
  final?: boolean
}

/**
 * Iterate the notation: every revision bumps the version and appends to
 * history, so the discovery trail (sets/variables found along the way)
 * stays visible.
 */
export function reviseDatasetNotation(
  previous: DatasetNotation | null | undefined,
  input: NotationRevisionInput,
): DatasetNotation {
  const version = (previous?.version ?? 0) + 1
  const revision: DatasetNotationRevision = {
    version,
    latex: input.latex,
    reason: input.reason,
    at: Date.now(),
  }
  return {
    version,
    status: input.final ? "result" : "plan",
    latex: input.latex,
    symbols: input.symbols ?? previous?.symbols ?? [],
    predicates: input.predicates ?? previous?.predicates ?? [],
    history: [...(previous?.history ?? []), revision],
  }
}

/* ── LaTeX helpers ──────────────────────────────────────────────── */

/** escape an identifier for use inside \text{} */
export function latexIdentifier(name: string): string {
  return `\\text{${String(name).replace(/([#$%&_{}])/g, "\\$1")}}`
}

function latexFieldType(type: string): string {
  if (type === "number") return "\\mathbb{R}"
  if (type === "integer") return "\\mathbb{Z}"
  if (type === "boolean") return "\\{\\top,\\bot\\}"
  return "\\Sigma^{*}"
}

/* ── deterministic notation for query-backed datasets ───────────── */

type JsonSchemaLike = {
  title?: string
  schema?: Record<string, any>
  properties?: Record<string, any>
}

const JSON_SCHEMA_KEYWORDS = new Set([
  "type",
  "title",
  "description",
  "required",
  "items",
  "additionalProperties",
])

function schemaProperties(schema: JsonSchemaLike | null | undefined) {
  const root = (schema?.schema ?? schema ?? {}) as Record<string, any>
  if (root.properties && typeof root.properties === "object") {
    return root.properties as Record<string, any>
  }
  // flat shape from query inference: { fieldName: "type", ... }
  const flat: Record<string, any> = {}
  for (const [key, value] of Object.entries(root)) {
    if (JSON_SCHEMA_KEYWORDS.has(key)) continue
    if (typeof value === "string") flat[key] = value
    else if (value && typeof value === "object" && typeof value.type === "string") {
      flat[key] = value
    }
  }
  return flat
}

/**
 * A query-backed dataset has a complete deterministic description: the
 * dataset is the image of a known query over a known domain. No model is
 * involved, so here the formal definition and its predicates derive
 * mechanically from the query, the inferred schema and the row count — and
 * those predicates DO carry arithmetic evidence (the special case where the
 * formal claims happen to be fully mechanical).
 */
export function inferQueryNotation(params: {
  entityNames: string[]
  rowCount: number
  schema?: JsonSchemaLike | null
  explanation?: string
}): DatasetNotation {
  const sources = params.entityNames.length ? params.entityNames : ["Domain"]
  const sourceSymbols: DatasetNotationSymbol[] = sources.map((name) => ({
    name,
    latex: latexIdentifier(name),
    kind: "set",
    description: `Entidad de origen ${name}`,
  }))

  const union = sources.map((name) => latexIdentifier(name)).join(" \\cup ")
  const latex = `\\mathcal{D} = \\left\\{\\, r \\;\\middle|\\; r \\in Q\\!\\left(${union}\\right) \\right\\}`

  const properties = schemaProperties(params.schema)
  const predicates: DatasetNotationPredicate[] = [
    {
      id: "cardinality",
      description: `El dataset tiene exactamente ${params.rowCount} filas`,
      latex: `|\\mathcal{D}| = ${params.rowCount}`,
      check: { kind: "row_count", op: "=", value: params.rowCount },
    },
  ]

  for (const [field, raw] of Object.entries(properties)) {
    const type = typeof raw === "string" ? raw : String(raw?.type ?? "")
    if (!["number", "integer", "boolean", "string"].includes(type)) continue
    predicates.push({
      id: `type_${field}`,
      description: `Toda fila tiene ${field} de tipo ${type} (o nulo)`,
      latex: `\\forall r \\in \\mathcal{D}:\\; r.${latexIdentifier(field)} \\in ${latexFieldType(type)} \\cup \\{\\varnothing\\}`,
      check: {
        kind: "field_type",
        field,
        type: type as "number" | "integer" | "boolean" | "string",
        allowNull: true,
      },
    })
  }

  return reviseDatasetNotation(null, {
    latex,
    symbols: [
      {
        name: "D",
        latex: "\\mathcal{D}",
        kind: "set",
        description: params.explanation?.trim() || "Dataset materializado",
      },
      {
        name: "Q",
        kind: "function",
        description: "Consulta InstaQL aplicada al dominio",
      },
      ...sourceSymbols,
    ],
    predicates,
    reason: "Notación determinística derivada de la consulta al dominio",
    final: true,
  })
}

/* ── arithmetic evaluation ──────────────────────────────────────── */

function readPath(row: any, path: string): unknown {
  let current: any = row
  for (const segment of String(path).split(".")) {
    if (current === null || current === undefined) return undefined
    current = current[segment]
  }
  return current
}

function compare(op: NotationCmpOp, left: number, right: number, tolerance = 0): boolean {
  switch (op) {
    case "=":
      return Math.abs(left - right) <= tolerance
    case "!=":
      return Math.abs(left - right) > tolerance
    case "<":
      return left < right
    case "<=":
      return left <= right + tolerance
    case ">":
      return left > right
    case ">=":
      return left >= right - tolerance
  }
}

type CheckOutcome = { ok: boolean; detail: string }

export function evaluateNotationCheck(rows: any[], check: NotationCheck): CheckOutcome {
  switch (check.kind) {
    case "row_count": {
      const ok = compare(check.op, rows.length, check.value)
      return { ok, detail: `|D| = ${rows.length} ${check.op} ${check.value}` }
    }
    case "field_type": {
      let failures = 0
      let firstFailure = ""
      for (const row of rows) {
        const value = readPath(row, check.field)
        if (value === null || value === undefined) {
          if (check.allowNull) continue
          failures += 1
          if (!firstFailure) firstFailure = "null"
          continue
        }
        const okValue =
          check.type === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : check.type === "integer"
              ? typeof value === "number" && Number.isInteger(value)
              : check.type === "boolean"
                ? typeof value === "boolean"
                : typeof value === "string"
        if (!okValue) {
          failures += 1
          if (!firstFailure) firstFailure = JSON.stringify(value)?.slice(0, 40) ?? "?"
        }
      }
      return {
        ok: failures === 0,
        detail:
          failures === 0
            ? `∀r: ${check.field} : ${check.type}`
            : `${failures}/${rows.length} filas violan ${check.field} : ${check.type} (ej: ${firstFailure})`,
      }
    }
    case "field_range": {
      let failures = 0
      for (const row of rows) {
        const value = readPath(row, check.field)
        if (typeof value !== "number" || Number.isNaN(value)) continue
        if (check.min !== undefined && value < check.min) failures += 1
        else if (check.max !== undefined && value > check.max) failures += 1
      }
      const bounds = [
        check.min !== undefined ? `≥ ${check.min}` : "",
        check.max !== undefined ? `≤ ${check.max}` : "",
      ]
        .filter(Boolean)
        .join(" ∧ ")
      return {
        ok: failures === 0,
        detail:
          failures === 0
            ? `∀r: ${check.field} ${bounds}`
            : `${failures}/${rows.length} filas fuera de rango en ${check.field}`,
      }
    }
    case "field_in": {
      const allowed = new Set(check.values.map((value) => JSON.stringify(value)))
      let failures = 0
      for (const row of rows) {
        const value = readPath(row, check.field)
        if (value === null || value === undefined) continue
        if (!allowed.has(JSON.stringify(value))) failures += 1
      }
      return {
        ok: failures === 0,
        detail:
          failures === 0
            ? `∀r: ${check.field} ∈ {${check.values.join(", ")}}`
            : `${failures}/${rows.length} filas con ${check.field} fuera del conjunto`,
      }
    }
    case "field_nonnull": {
      let failures = 0
      for (const row of rows) {
        const value = readPath(row, check.field)
        if (value === null || value === undefined || value === "") failures += 1
      }
      return {
        ok: failures === 0,
        detail:
          failures === 0
            ? `∀r: ${check.field} ≠ ∅`
            : `${failures}/${rows.length} filas con ${check.field} vacío`,
      }
    }
    case "field_matches": {
      let regex: RegExp
      try {
        regex = new RegExp(check.pattern)
      } catch {
        return { ok: false, detail: `patrón inválido: ${check.pattern}` }
      }
      let failures = 0
      for (const row of rows) {
        const value = readPath(row, check.field)
        if (typeof value !== "string") continue
        if (!regex.test(value)) failures += 1
      }
      return {
        ok: failures === 0,
        detail:
          failures === 0
            ? `∀r: ${check.field} ~ /${check.pattern}/`
            : `${failures}/${rows.length} filas no matchean /${check.pattern}/`,
      }
    }
    case "unique": {
      const seen = new Set<string>()
      let duplicates = 0
      for (const row of rows) {
        const key = JSON.stringify(check.fields.map((field) => readPath(row, field)))
        if (seen.has(key)) duplicates += 1
        else seen.add(key)
      }
      return {
        ok: duplicates === 0,
        detail:
          duplicates === 0
            ? `(${check.fields.join(", ")}) es clave`
            : `${duplicates} duplicados sobre (${check.fields.join(", ")})`,
      }
    }
    case "aggregate": {
      const values: number[] = []
      for (const row of rows) {
        if (check.fn === "count" && !check.field) continue
        const value = readPath(row, String(check.field))
        if (typeof value === "number" && Number.isFinite(value)) values.push(value)
      }
      let actual: number
      switch (check.fn) {
        case "count":
          actual = check.field ? values.length : rows.length
          break
        case "sum":
          actual = values.reduce((total, value) => total + value, 0)
          break
        case "min":
          actual = values.length ? Math.min(...values) : Number.NaN
          break
        case "max":
          actual = values.length ? Math.max(...values) : Number.NaN
          break
        case "avg":
          actual = values.length
            ? values.reduce((total, value) => total + value, 0) / values.length
            : Number.NaN
          break
      }
      const tolerance = check.tolerance ?? 1e-9
      const ok = Number.isFinite(actual) && compare(check.op, actual, check.value, tolerance)
      return {
        ok,
        detail: `${check.fn}(${check.field ?? "*"}) = ${Number.isFinite(actual) ? actual : "∅"} ${check.op} ${check.value}`,
      }
    }
    case "and": {
      const results = check.checks.map((inner) => evaluateNotationCheck(rows, inner))
      return {
        ok: results.every((result) => result.ok),
        detail: results.map((result) => result.detail).join(" ∧ "),
      }
    }
    case "or": {
      const results = check.checks.map((inner) => evaluateNotationCheck(rows, inner))
      return {
        ok: results.some((result) => result.ok),
        detail: results.map((result) => result.detail).join(" ∨ "),
      }
    }
    case "not": {
      const result = evaluateNotationCheck(rows, check.check)
      return { ok: !result.ok, detail: `¬(${result.detail})` }
    }
    case "implies": {
      const antecedent = evaluateNotationCheck(rows, check.if)
      if (!antecedent.ok) {
        return { ok: true, detail: `(${antecedent.detail}) → ⊤ (antecedente falso)` }
      }
      const consequent = evaluateNotationCheck(rows, check.then)
      return {
        ok: consequent.ok,
        detail: `(${antecedent.detail}) → (${consequent.detail})`,
      }
    }
  }
}

/**
 * Annotate a notation with ADVISORY arithmetic evidence over the produced
 * rows. Never throws, never blocks, and never changes the notation's
 * lifecycle status — the dataset's validity is trusted, not proven here.
 *
 * Each predicate is reported as:
 * - "asserted"     no arithmetic form (formal/semantic claim, trusted)
 * - "supported"    arithmetic evidence agrees
 * - "contradicted" arithmetic evidence disagrees (a hint to look, not a
 *                  verdict that the dataset is wrong)
 * A check that can't be evaluated stays "asserted" — we don't downgrade a
 * trusted claim because of a malformed mechanical form.
 */
export function annotateNotationEvidence(
  notation: DatasetNotation,
  rows: any[],
): DatasetNotation {
  const checks: DatasetNotationCheckResult[] = []
  for (const predicate of notation.predicates ?? []) {
    if (!predicate.check) {
      checks.push({ predicateId: predicate.id, status: "asserted" })
      continue
    }
    try {
      const outcome = evaluateNotationCheck(rows, predicate.check)
      checks.push({
        predicateId: predicate.id,
        status: outcome.ok ? "supported" : "contradicted",
        detail: outcome.detail,
      })
    } catch (error) {
      checks.push({
        predicateId: predicate.id,
        status: "asserted",
        detail: `no evaluable: ${String(error).slice(0, 120)}`,
      })
    }
  }
  return {
    ...notation,
    checks,
    evidenceAt: Date.now(),
  }
}

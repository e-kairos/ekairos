import { randomUUID } from "node:crypto"

import { id } from "@instantdb/core"
import type { DomainEventDraft } from "@ekairos/domain"
import {
  Context,
  Events,
  type ContextRuntimeWithDomainUse,
} from "@ekairos/context"
import {
  type ReactionDefinition,
  type ReactionEffect,
} from "@ekairos/reactor"

/**
 * Every eval case emits a real domain event into a fresh persisted Context and
 * executes the supplied ReactionDefinition. Scorers receive the returned
 * effects as `output` plus the persisted execution trace.
 */

export type EvalsRuntime = ContextRuntimeWithDomainUse & {
  db(): Promise<any>
}

export type EvalCase = {
  key: string
  /** The real domain event draft used to trigger the reaction. */
  event: DomainEventDraft<any, any, any, any, any, any>
  /** Context content supplied to the reaction. */
  content: unknown
  /** Ground truth handed to scorers. */
  expected?: unknown
  /** Text-only cases were removed. This keeps accidental legacy input invalid. */
  text?: never
}

export type EvalScore = {
  score: number
  reason?: string
}

export type EvalEventSnapshot = {
  id: string
  type: string
  domain: string | null
  name: string | null
  createdAt: unknown
  parts: Array<Record<string, any>>
}

export type EvalReactionSnapshot = {
  id: string
  type: string
  status: string
  position: number
  depth: number
  causeIds: string[]
  effectIds: string[]
}

export type EvalContextSnapshot = {
  contextId: string
  contextKey: string | null
  sessionId: string
  sessionStatus: string
  reactions: EvalReactionSnapshot[]
  events: EvalEventSnapshot[]
  /** Canonical parts of every Event, flattened in causal order. */
  parts: Array<Record<string, any>>
  effects: Array<Record<string, any>>
}

export type EvalScorerInput = {
  evalCase: EvalCase
  /** Effect or effects returned by `context.react(...)`. */
  output: ReactionEffect
  expected: unknown
  snapshot: EvalContextSnapshot
}

export type EvalScorer = {
  name: string
  /** Scores in [0, 1]. */
  score(input: EvalScorerInput): Promise<EvalScore> | EvalScore
}

export type EvalSuiteConfig = {
  key: string
  definition: ReactionDefinition<any, any, any, any>
  cases: EvalCase[]
  scorers: EvalScorer[]
  /** A case passes when every scorer reaches this threshold. Default 1. */
  passThreshold?: number
}

export type EvalCaseResult = {
  key: string
  contextId: string | null
  sessionId: string | null
  /** Effect or effects returned by the evaluated reaction. */
  output: ReactionEffect | undefined
  scores: Array<EvalScore & { name: string }>
  passed: boolean
  error?: string
  durationMs: number
}

export type EvalReport = {
  suiteKey: string
  runId: string | null
  startedAt: string
  finishedAt: string
  cases: EvalCaseResult[]
  summary: {
    total: number
    passed: number
    /** Mean score per scorer across scored cases. */
    scorers: Record<string, number>
  }
}

export type EvalSuite = EvalSuiteConfig & {
  run(options: RunEvalOptions): Promise<EvalReport>
}

export type RunEvalOptions = {
  runtime: EvalsRuntime
  /**
   * Persist the run and per-case results as eval_runs / eval_results entities
   * linked to their contexts. Degrades to a warning when the schema is not
   * provisioned. Default true.
   */
  persist?: boolean
}

export function defineEval(config: EvalSuiteConfig): EvalSuite {
  if (!config.key?.trim()) throw new Error("defineEval requires a key.")
  if (!config.definition) throw new Error(`Eval "${config.key}" requires a reaction definition.`)
  if (!config.cases?.length) throw new Error(`Eval "${config.key}" has no cases.`)
  if (!config.scorers?.length) throw new Error(`Eval "${config.key}" has no scorers.`)
  return {
    ...config,
    run: (options) => runEval(config, options),
  }
}

export async function runEval(
  suite: EvalSuiteConfig,
  options: RunEvalOptions,
): Promise<EvalReport> {
  const startedAt = new Date()
  const passThreshold = suite.passThreshold ?? 1
  const results: EvalCaseResult[] = []

  for (const evalCase of suite.cases) {
    results.push(
      await runEvalCase({
        suite,
        evalCase,
        runtime: options.runtime,
        passThreshold,
      }),
    )
  }

  const finishedAt = new Date()
  const scorerTotals = new Map<string, { sum: number; count: number }>()
  for (const result of results) {
    for (const score of result.scores) {
      const entry = scorerTotals.get(score.name) ?? { sum: 0, count: 0 }
      entry.sum += score.score
      entry.count += 1
      scorerTotals.set(score.name, entry)
    }
  }

  const report: EvalReport = {
    suiteKey: suite.key,
    runId: null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    cases: results,
    summary: {
      total: results.length,
      passed: results.filter((result) => result.passed).length,
      scorers: Object.fromEntries(
        [...scorerTotals.entries()].map(([name, { sum, count }]) => [
          name,
          count > 0 ? sum / count : 0,
        ]),
      ),
    },
  }

  if (options.persist !== false) {
    report.runId = await persistEvalReport(options.runtime, report)
  }

  return report
}

async function runEvalCase(params: {
  suite: EvalSuiteConfig
  evalCase: EvalCase
  runtime: EvalsRuntime
  passThreshold: number
}): Promise<EvalCaseResult> {
  const { suite, evalCase, runtime } = params
  const caseStartedAt = Date.now()
  const contextKey = `eval:${suite.key}:${evalCase.key}:${randomUUID().slice(0, 8)}`
  let contextId: string | null = null

  try {
    const context = await Context(runtime).create({
      key: contextKey,
      content: evalCase.content,
    })
    contextId = context.id

    const trigger = await Events(runtime).emit(evalCase.event, {
      id: randomUUID(),
      channel: "web",
      contextId: context.id,
      createdAt: new Date(),
    })
    const output = await context.react(trigger, suite.definition)
    const snapshot = await fetchContextSnapshot(runtime, {
      contextId: context.id,
      contextKey,
      triggerId: trigger.id,
    })

    const scores: Array<EvalScore & { name: string }> = []
    for (const scorer of suite.scorers) {
      try {
        const score = await scorer.score({
          evalCase,
          output,
          expected: evalCase.expected,
          snapshot,
        })
        scores.push({
          name: scorer.name,
          score: clampScore(score.score),
          reason: score.reason,
        })
      } catch (error) {
        scores.push({
          name: scorer.name,
          score: 0,
          reason: `scorer failed: ${errorMessage(error)}`,
        })
      }
    }

    return {
      key: evalCase.key,
      contextId: context.id,
      sessionId: snapshot.sessionId,
      output,
      scores,
      passed:
        scores.length > 0 &&
        scores.every((score) => score.score >= params.passThreshold),
      durationMs: Date.now() - caseStartedAt,
    }
  } catch (error) {
    return {
      key: evalCase.key,
      contextId,
      sessionId: null,
      output: undefined,
      scores: [],
      passed: false,
      error: errorMessage(error),
      durationMs: Date.now() - caseStartedAt,
    }
  }
}

export async function fetchContextSnapshot(
  runtime: EvalsRuntime,
  ref: {
    contextId: string
    contextKey: string | null
    sessionId?: string
    triggerId?: string
  },
): Promise<EvalContextSnapshot> {
  const db = await runtime.db()
  const snapshot = await db.query({
    context_contexts: {
      $: { where: { id: ref.contextId }, limit: 1 },
      sessions: {
        trigger: {},
        rootReaction: { effects: {} },
        reactions: { causes: {}, effects: {} },
      },
      events: { eventParts: {} },
    },
  })

  const contextRow = asRows(snapshot?.context_contexts)[0] ?? {}
  const sessions = asRows(contextRow.sessions)
  const session =
    (ref.sessionId
      ? sessions.find((row) => String(row.id) === ref.sessionId)
      : undefined) ??
    (ref.triggerId
      ? sessions.find((row) => String(one(row.trigger)?.id ?? "") === ref.triggerId)
      : undefined) ??
    sessions[0] ??
    {}

  const reactions: EvalReactionSnapshot[] = asRows(session.reactions)
    .sort((left, right) => Number(left.position ?? 0) - Number(right.position ?? 0))
    .map((reaction) => ({
      id: String(reaction.id ?? ""),
      type: String(reaction.type ?? ""),
      status: String(reaction.status ?? ""),
      position: Number(reaction.position ?? 0),
      depth: Number(reaction.depth ?? 0),
      causeIds: asRows(reaction.causes).map((event) => String(event.id)),
      effectIds: asRows(reaction.effects).map((event) => String(event.id)),
    }))
  const events: EvalEventSnapshot[] = asRows(contextRow.events)
    .sort(compareCreatedAt)
    .map((event) => ({
      id: String(event.id ?? ""),
      type: String(event.type ?? ""),
      domain: event.domain ? String(event.domain) : null,
      name: event.name ? String(event.name) : null,
      createdAt: event.createdAt ?? null,
      parts: asRows(event.eventParts)
        .sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0))
        .map((part) => asRecord(part.content)),
    }))
  const rootReaction = one(session.rootReaction)

  return {
    contextId: ref.contextId,
    contextKey: contextRow.key ? String(contextRow.key) : ref.contextKey,
    sessionId: String(session.id ?? ref.sessionId ?? ""),
    sessionStatus: String(session.status ?? ""),
    reactions,
    events,
    parts: events.flatMap((event) => event.parts),
    effects: asRows(rootReaction?.effects),
  }
}

async function persistEvalReport(
  runtime: EvalsRuntime,
  report: EvalReport,
): Promise<string | null> {
  try {
    const db = await runtime.db()
    const runId = id()

    await db.transact([
      db.tx.eval_runs[runId].update({
        suiteKey: report.suiteKey,
        status: report.summary.passed === report.summary.total ? "passed" : "failed",
        casesTotal: report.summary.total,
        casesPassed: report.summary.passed,
        summary: report.summary,
        startedAt: new Date(report.startedAt),
        finishedAt: new Date(report.finishedAt),
      }),
    ])

    for (const result of report.cases) {
      const resultId = id()
      const transactions = [
        db.tx.eval_results[resultId].update({
          caseKey: result.key,
          passed: result.passed,
          output: toJsonSafe(result.output),
          scores: result.scores,
          error: result.error ?? null,
          createdAt: new Date(),
        }),
        db.tx.eval_results[resultId].link({
          run: runId,
          ...(result.contextId ? { context: result.contextId } : {}),
          ...(result.sessionId ? { session: result.sessionId } : {}),
        }),
      ]
      await db.transact(transactions)
    }

    return runId
  } catch (error) {
    console.warn(
      `[ekairos/evals] could not persist eval run (is evalDomain provisioned?): ${errorMessage(error)}`,
    )
    return null
  }
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function asRows(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? (value as Record<string, any>[]) : []
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {}
}

function one(value: unknown): Record<string, any> | null {
  if (Array.isArray(value)) {
    const first = value[0]
    return first && typeof first === "object" ? asRecord(first) : null
  }
  return value && typeof value === "object" ? asRecord(value) : null
}

function compareCreatedAt(left: Record<string, any>, right: Record<string, any>): number {
  return new Date(left.createdAt ?? 0).getTime() - new Date(right.createdAt ?? 0).getTime()
}

function toJsonSafe(value: unknown): unknown {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

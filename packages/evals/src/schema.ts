import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"
import { contextDomain } from "@ekairos/events/schema"

const entities = {
  eval_runs: i.entity({
    suiteKey: i.string().optional().indexed(),
    status: i.string().optional().indexed(),
    casesTotal: i.number().optional(),
    casesPassed: i.number().optional(),
    summary: i.json().optional(),
    startedAt: i.date().optional().indexed(),
    finishedAt: i.date().optional(),
  }),
  eval_results: i.entity({
    caseKey: i.string().optional().indexed(),
    passed: i.boolean().optional().indexed(),
    output: i.json().optional(),
    expected: i.json().optional(),
    scores: i.json().optional(),
    error: i.string().optional(),
    createdAt: i.date().optional().indexed(),
  }),
}

const links = {
  evalRunResults: {
    forward: { on: "eval_runs", has: "many", label: "results" },
    reverse: { on: "eval_results", has: "one", label: "run", onDelete: "cascade" },
  },
  evalResultContext: {
    forward: { on: "eval_results", has: "one", label: "context" },
    reverse: { on: "context_contexts", has: "many", label: "evalResults" },
  },
  evalResultSession: {
    forward: { on: "eval_results", has: "one", label: "session" },
    reverse: { on: "context_sessions", has: "many", label: "evalResults" },
  },
} as const

export const evalDomain = domain({
  name: "evals",
  packageName: "@ekairos/evals",
})
  .includes(contextDomain)
  .withSchema({ entities, links, rooms: {} as const })

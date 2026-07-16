/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { init } from "@instantdb/admin"
import { z } from "zod"

import { defineEvent, domain, EkairosRuntime } from "@ekairos/domain"
import { contextDomain } from "@ekairos/context"
import { defineReaction, type ReactionEngine } from "@ekairos/reactor"
import {
  destroyContextTestApp,
  hasInstantProvisionToken,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"

import { defineEval } from "../evals.ts"
import * as scorers from "../scorers.ts"
import { evalDomain } from "../schema.ts"

const describeInstant = hasInstantProvisionToken() ? describe : describe.skip

const evalsTestDomain = domain("evalsTest")
  .includes(contextDomain)
  .includes(evalDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    requested: defineEvent({
      payload: z.object({ question: z.string() }),
    }),
    answered: defineEvent({
      payload: z.object({ answer: z.string() }),
    }),
  })

const answerSchema = z.object({ answer: z.string() })
const answerEngine: ReactionEngine = {
  async agent<TOutput>() {
    return { output: { answer: "42" } as TOutput }
  },
}

const answerReaction = defineReaction(
  evalsTestDomain.events.requested,
  {
    key: "evals.answer",
    scope: evalsTestDomain,
    engine: answerEngine,
    sandbox: false,
  },
  async current => {
    const answer = await current.given(current.trigger).agent({
      instruction: `Answer ${current.context.content.topic}.`,
      output: answerSchema,
    })
    return await current.given(answer).emit(
      evalsTestDomain.events.answered(answer.payload),
    )
  },
)

const effectPayloadScorer = scorers.custom(
  "effect_payload",
  ({ output, expected }) => {
    const effect = Array.isArray(output) ? output[0] : output
    const equal = (effect as any)?.payload?.answer === (expected as any)?.answer
    return { score: equal ? 1 : 0 }
  },
)

describe("@ekairos/evals Reaction API", () => {
  it("requires a ReactionDefinition", () => {
    expect(() => defineEval({
      key: "missing-definition",
      definition: undefined as never,
      cases: [{
        key: "case",
        event: evalsTestDomain.events.requested({ question: "answer" }),
        content: { topic: "the question" },
      }],
      scorers: [effectPayloadScorer],
    })).toThrow("requires a reaction definition")
  })
})

type EvalsTestEnv = { appId: string; adminToken: string }

class EvalsTestRuntime extends EkairosRuntime<
  EvalsTestEnv,
  typeof evalsTestDomain,
  ReturnType<typeof init>
> {
  protected getDomain() {
    return evalsTestDomain
  }

  protected async resolveDb(env: EvalsTestEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: evalsTestDomain.instantSchema(),
      useDateObjects: true,
    } as any)
  }
}

describeInstant("@ekairos/evals persisted Reaction runs", () => {
  let appId = ""
  let db: ReturnType<typeof init>
  let runtime: EvalsTestRuntime

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: `evals-reaction-test-${Date.now()}`,
      schema: evalsTestDomain.instantSchema(),
    })
    appId = app.appId
    db = init({
      appId,
      adminToken: app.adminToken,
      schema: evalsTestDomain.instantSchema(),
      useDateObjects: true,
    } as any)
    runtime = new EvalsTestRuntime({
      appId,
      adminToken: app.adminToken,
    })
  }, 5 * 60 * 1000)

  afterAll(async () => {
    if (process.env.APP_TEST_PERSIST !== "true") {
      await destroyContextTestApp(appId)
    }
  })

  it("emits case events, scores returned effects, and persists trace links", async () => {
    const suite = defineEval({
      key: "reaction.answers",
      definition: answerReaction,
      cases: [
        {
          key: "meaning-of-life",
          event: evalsTestDomain.events.requested({
            question: "What is the answer?",
          }),
          content: { topic: "the meaning of life" },
          expected: { answer: "42" },
        },
        {
          key: "wrong-expectation",
          event: evalsTestDomain.events.requested({
            question: "What is the answer?",
          }),
          content: { topic: "the meaning of life" },
          expected: { answer: "43" },
        },
      ],
      scorers: [effectPayloadScorer, scorers.sessionCompleted()],
    })

    const report = await suite.run({ runtime })

    expect(report.summary).toMatchObject({
      total: 2,
      passed: 1,
      scorers: {
        effect_payload: 0.5,
        session_completed: 1,
      },
    })

    const passing = report.cases.find(entry => entry.key === "meaning-of-life")
    expect(passing).toMatchObject({
      passed: true,
      output: {
        domain: "evalsTest",
        name: "answered",
        payload: { answer: "42" },
      },
    })
    expect(passing?.contextId).toBeTruthy()
    expect(passing?.sessionId).toBeTruthy()

    const persisted = await db.query({
      eval_runs: {
        $: { where: { id: String(report.runId) }, limit: 1 },
        results: {
          context: {},
          session: {
            trigger: {},
            rootReaction: { effects: {} },
          },
        },
      },
    } as any)
    const run = (persisted as any).eval_runs?.[0]
    expect(run).toMatchObject({
      suiteKey: "reaction.answers",
      casesTotal: 2,
      casesPassed: 1,
    })
    expect(run?.results).toHaveLength(2)
    for (const result of run?.results ?? []) {
      expect(result.context?.id).toBeTruthy()
      expect(result.session?.trigger?.name).toBe("requested")
      expect(result.session?.rootReaction?.effects?.[0]?.name).toBe("answered")
    }
  }, 120_000)
})

/* @vitest-environment node */

import { afterAll, beforeAll, expect } from "vitest"
import { init } from "@instantdb/admin"
import { z } from "zod"

import {
  Events,
  Part,
  contextDomain,
} from "../../../events/src/index.ts"
import {
  describeInstant,
  destroyContextTestApp,
  itInstant,
  provisionContextTestApp,
} from "../../../events/src/tests/_env.ts"
import { EventsTestRuntime } from "../../../events/src/tests/context.test-runtime.ts"
import { defineReactor } from "../reactor.ts"

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value as Record<string, unknown>[] : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

async function readContextSnapshot(
  db: ReturnType<typeof init>,
  key: string,
): Promise<Record<string, unknown>> {
  const snapshot = await db.query({
    event_contexts: {
      $: { where: { key }, limit: 1 },
      executions: {
        steps: {
          $: { order: { iteration: "asc" } },
          parts: {
            $: { order: { idx: "asc" } },
          },
        },
        output: {},
      },
    },
  } as any)

  return asRows((snapshot as any).event_contexts)[0] ?? {}
}

describeInstant("defineReactor", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>

  beforeAll(async () => {
    const app = await provisionContextTestApp({
      name: "reactor-define",
      schema: contextDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({
      appId,
      adminToken,
      schema: contextDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }, 60_000)

  afterAll(async () => {
    await destroyContextTestApp(appId)
  }, 60_000)

  itInstant("runs explicit semantic steps and completes with a typed output", async () => {
    const runtime = new EventsTestRuntime({ appId, adminToken })
    const triggerEvent = await Events(runtime)
      .builder({
        type: "input",
        channel: "web",
      })
      .simple(Part.message("Reconcile the document."))
      .create()

    const contextSchema = z.object({
      accountingDocumentId: z.string(),
      orderId: z.string(),
    })
    const proposalSchema = z.object({
      accepted: z.boolean(),
      confidence: z.number(),
    })
    const savedProposalSchema = z.object({
      proposalId: z.string(),
      proposal: proposalSchema,
    })

    const reactor = defineReactor({
      key: "reactor.order-match",
      scope: contextDomain,
      context: contextSchema,
      output: savedProposalSchema,
      engine: {
        step: async ({ step, actions, scope }) => {
          expect(scope.db).toBeTruthy()
          expect((scope.db as any).query).toBeTypeOf("function")
          expect((scope.db as any).transact).toBeUndefined()
          expect((scope as any).actions).toBeUndefined()

          if (step.key === "propose-item-matches") {
            return {
              accepted: true,
              confidence: 0.92,
            }
          }

          if (step.key === "save-order-match-proposal") {
            return await actions.saveOrderMatchProposal(step.input)
          }

          throw new Error(`unexpected step:${step.key}`)
        },
      },
      run: async ({ context, execution }) => {
        const proposal = await execution.step("propose-item-matches", {
          instructions: "Propose item matches between the accounting document and order.",
          output: proposalSchema,
        })

        const saved = await execution.step("save-order-match-proposal", {
          instructions: "Persist the generated order match proposal.",
          input: {
            proposal: proposal.output,
          },
          output: savedProposalSchema,
          actions: {
            saveOrderMatchProposal: async (input: unknown) => ({
              proposalId: `proposal:${context.content.accountingDocumentId}`,
              proposal: asRecord(input).proposal,
            }),
          },
        })

        await execution.complete({
          message: "Proposal ready.",
          step: saved,
        })
      },
    })(runtime)

    const reaction = await reactor.react(
      { key: "accounting-document:doc_1" },
      triggerEvent,
      {
        env: {},
        context: {
          accountingDocumentId: "doc_1",
          orderId: "order_1",
        },
      },
    )

    expect(reaction.result?.output).toEqual({
      proposalId: "proposal:doc_1",
      proposal: {
        accepted: true,
        confidence: 0.92,
      },
    })

    const contextRow = await readContextSnapshot(db, "accounting-document:doc_1")
    expect(asRecord(contextRow?.content).accountingDocumentId).toBe("doc_1")

    const execution = asRows(contextRow?.executions)[0]
    expect(execution?.id).toBe(reaction.executionId)
    expect(execution?.status).toBe("completed")

    const reactionEvent = asRecord(execution?.output)
    expect(reactionEvent.id).toBe(reaction.reactionEventId)
    expect(reactionEvent.status).toBe("completed")
    expect(asRecord(reactionEvent.content).finalStepId).toBeTruthy()

    const steps = asRows(execution?.steps)
    expect(steps).toHaveLength(3)
    expect(steps.map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ])

    const promptParts = asRows(steps[0]?.parts)
    expect(JSON.stringify(promptParts)).toContain("propose-item-matches")
    expect(JSON.stringify(promptParts)).toContain("Propose item matches")
    expect(JSON.stringify(promptParts)).toContain("0.92")

    const actionParts = asRows(steps[1]?.parts)
    expect(JSON.stringify(actionParts)).toContain("save-order-match-proposal")
    expect(JSON.stringify(actionParts)).toContain("saveOrderMatchProposal")
    expect(JSON.stringify(actionParts)).toContain("proposal:doc_1")

    const completeParts = asRows(steps[2]?.parts)
    expect(JSON.stringify(completeParts)).toContain("complete")
    expect(JSON.stringify(completeParts)).toContain("Proposal ready.")
    expect(JSON.stringify(completeParts)).toContain("proposal:doc_1")
  }, 60_000)

  itInstant("supports reactors without an initial context schema", async () => {
    const runtime = new EventsTestRuntime({ appId, adminToken })
    const triggerEvent = await Events(runtime)
      .builder({
        type: "input",
        channel: "web",
      })
      .simple(Part.message("Run without initial context."))
      .create()

    const reactor = defineReactor({
      key: "reactor.no-context",
      run: async ({ context, execution }) => {
        expect(context.content).toEqual({})
        await execution.complete({
          message: "No initial context required.",
        })
      },
    })(runtime)

    const reaction = await reactor.react(
      { key: "free-context:1" },
      triggerEvent,
      { env: {} },
    )

    expect(reaction.result?.output).toBeUndefined()

    const contextRow = await readContextSnapshot(db, "free-context:1")
    const execution = asRows(contextRow?.executions)[0]
    expect(execution?.status).toBe("completed")

    const reactionEvent = asRecord(execution?.output)
    expect(reactionEvent.status).toBe("completed")
    expect(asRecord(reactionEvent.content).finalStepId).toBeTruthy()
  }, 60_000)

  itInstant("fails explicitly when a reactor returns without completing", async () => {
    const runtime = new EventsTestRuntime({ appId, adminToken })
    const triggerEvent = await Events(runtime)
      .builder({ type: "input", channel: "web" })
      .simple(Part.message("Run an incomplete reactor."))
      .create()

    const reactor = defineReactor({
      key: "reactor.incomplete",
      run: async () => {
        return
      },
    })(runtime)

    await expect(
      reactor.react(
        { key: "incomplete-context:1" },
        triggerEvent,
        { env: {} },
      ),
    ).rejects.toThrow('Reactor reactor.incomplete finished without calling execution.complete().')

    const contextRow = await readContextSnapshot(db, "incomplete-context:1")
    const execution = asRows(contextRow?.executions)[0]
    expect(execution?.status).toBe("failed")

    const reactionEvent = asRecord(execution?.output)
    expect(reactionEvent.status).toBe("pending")
    expect(JSON.stringify(reactionEvent.content)).toContain("execution.complete")
  }, 60_000)

  itInstant("persists failed step errors on the reaction execution", async () => {
    const runtime = new EventsTestRuntime({ appId, adminToken })
    const triggerEvent = await Events(runtime)
      .builder({ type: "input", channel: "web" })
      .simple(Part.message("Run a failing reactor step."))
      .create()

    const reactor = defineReactor({
      key: "reactor.step-failure",
      run: async ({ execution }) => {
        await execution.step("needs-engine", {
          instructions: "This step asks for structured output but no engine is configured.",
          output: z.object({ ok: z.boolean() }),
        })
      },
    })(runtime)

    await expect(
      reactor.react(
        { key: "failing-context:1" },
        triggerEvent,
        { env: {} },
      ),
    ).rejects.toThrow('requires an engine because it declares output')

    const contextRow = await readContextSnapshot(db, "failing-context:1")
    const execution = asRows(contextRow?.executions)[0]
    expect(execution?.status).toBe("failed")

    const reactionEvent = asRecord(execution?.output)
    expect(reactionEvent.status).toBe("pending")
    expect(JSON.stringify(reactionEvent.content)).toContain("requires an engine")

    const steps = asRows(execution?.steps)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.status).toBe("failed")
    expect(steps[0]?.errorText).toContain("requires an engine")
    expect(JSON.stringify(steps[0]?.parts)).toContain("reactor.step.error")
  }, 60_000)
})

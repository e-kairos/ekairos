import { init } from "@instantdb/admin"
import { z } from "zod"

import { Context } from "../../context/src/index.ts"
import { EkairosRuntime } from "@ekairos/domain"
import { Part } from "@ekairos/events"
import { getSessionId, scripted } from "@ekairos/reactor"

import type { ReactionChatInput } from "../../../scripts/reaction-chat/contract.ts"
import {
  planSchema,
  reactionChatDomain,
  reactionChatScope,
  requestSchema,
  researchSchema,
  risksSchema,
  synthesisSchema,
} from "./reaction-chat.domain.ts"

const PLAN = "Plan the request and split it into research and risk workstreams."
const RESEARCH = "Research the plan and produce evidence-backed findings."
const RISKS = "Assess the plan's risks and propose mitigations."
const SYNTHESIZE = "Synthesize research and risks into one recommendation."

type RuntimeEnv = Readonly<{
  appId: string
  adminToken: string
}>

class ReactionChatRuntime extends EkairosRuntime<
  RuntimeEnv,
  typeof reactionChatDomain,
  ReturnType<typeof init>
> {
  protected getDomain() {
    return reactionChatDomain
  }

  protected async resolveDb(env: RuntimeEnv) {
    return init({
      ...env,
      schema: reactionChatDomain.instantSchema(),
      useDateObjects: true,
    } as never)
  }
}

function requiredEnv(name: "REACTION_CHAT_INSTANT_APP_ID" | "REACTION_CHAT_INSTANT_ADMIN_TOKEN") {
  const value = String(process.env[name] ?? "").trim()
  if (!value) throw new Error(`reaction_chat_env_required:${name}`)
  return value
}

const runtime = new ReactionChatRuntime({
  appId: requiredEnv("REACTION_CHAT_INSTANT_APP_ID"),
  adminToken: requiredEnv("REACTION_CHAT_INSTANT_ADMIN_TOKEN"),
})

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds))

function chunks(text: string, size = 11): readonly string[] {
  return text.match(new RegExp(`.{1,${size}}`, "g")) ?? [text]
}

type SourceDocument = Readonly<{
  type: "source-document"
  sourceId: string
  mediaType: string
  title: string
  filename?: string
}>

function sourcePart(...sources: readonly SourceDocument[]) {
  return Part.new({ type: "source", content: { sources: [...sources] } })
}

function reasoningPart(text: string) {
  return Part.new({ type: "reasoning", content: { text, state: "done" } })
}

function messagePart(text: string, value: unknown) {
  return Part.message({ text, blocks: [{ type: "json", value }] })
}

function streamedParts(input: Readonly<{
  reasoning: string
  text: string
  sources?: readonly SourceDocument[]
  delayMs: number
}>) {
  return async function* () {
    for (const delta of chunks(input.reasoning)) {
      yield {
        kind: "reasoning.delta" as const,
        round: 0,
        partId: "reasoning:0",
        delta,
      }
      await wait(input.delayMs)
    }
    yield {
      kind: "reasoning.completed" as const,
      round: 0,
      partId: "reasoning:0",
    }
    for (const source of input.sources ?? []) {
      yield {
        kind: "source.available" as const,
        round: 0,
        data: { source },
      }
    }
    for (const delta of chunks(input.text)) {
      yield {
        kind: "text.delta" as const,
        round: 0,
        partId: "message:0",
        delta,
      }
      await wait(input.delayMs)
    }
  }()
}

function payloadFromEvents<T>(
  schema: z.ZodType<T>,
  events: readonly { payload: unknown }[],
): T {
  for (const event of [...events].reverse()) {
    const parsed = schema.safeParse(event.payload)
    if (parsed.success) return parsed.data
  }
  throw new Error("reaction_chat_context_payload_required")
}

const requestSource: SourceDocument = {
  type: "source-document",
  sourceId: "request",
  mediaType: "application/json",
  title: "Incoming reaction request",
  filename: "request.json",
}

const researchSource: SourceDocument = {
  type: "source-document",
  sourceId: "research",
  mediaType: "application/json",
  title: "Research branch result",
  filename: "research.json",
}

const risksSource: SourceDocument = {
  type: "source-document",
  sourceId: "risks",
  mediaType: "application/json",
  title: "Risk branch result",
  filename: "risks.json",
}

const reactionChatReactor = scripted({
  agent(input) {
    switch (input.instruction) {
      case PLAN: {
        const request = requestSchema.parse(input.trigger.payload)
        const output = planSchema.parse({
          objective: request.text,
          workstreams: ["research", "risks"],
        })
        const reasoning = "Decompose the request into two independent branches that can run concurrently."
        const text = `Plan ready for: ${output.objective}`
        return {
          output,
          parts: [
            reasoningPart(reasoning),
            sourcePart(requestSource),
            messagePart(text, output),
          ],
          stream: streamedParts({ reasoning, text, sources: [requestSource], delayMs: 55 }),
          metadata: { stage: "plan" },
        }
      }
      case RESEARCH: {
        const plan = payloadFromEvents(planSchema, input.events)
        const output = researchSchema.parse({
          objective: plan.objective,
          findings: [
            "Each agent call owns an independently durable model Event.",
            "Explicit Event fan-in preserves both branch results as causes.",
          ],
          evidenceCount: 2,
        })
        const reasoning = "Inspect the plan for concrete framework capabilities and durable evidence."
        const text = `Research found ${output.evidenceCount} supporting signals.`
        return {
          output,
          parts: [
            reasoningPart(reasoning),
            sourcePart(requestSource),
            messagePart(text, output),
          ],
          stream: streamedParts({ reasoning, text, sources: [requestSource], delayMs: 105 }),
          metadata: { stage: "research", branch: "parallel" },
        }
      }
      case RISKS: {
        const plan = payloadFromEvents(planSchema, input.events)
        const output = risksSchema.parse({
          objective: plan.objective,
          risks: [
            {
              risk: "A long-running branch can fail independently.",
              mitigation: "Persist every agent result as its own Event.",
            },
            {
              risk: "Concurrent output can appear ambiguous.",
              mitigation: "Render explicit causal lanes and Event Parts.",
            },
          ],
        })
        const reasoning = "Challenge the plan independently while research continues on the sibling branch."
        const text = `Risk review identified ${output.risks.length} mitigated risks.`
        return {
          output,
          parts: [
            reasoningPart(reasoning),
            messagePart(text, output),
          ],
          stream: streamedParts({ reasoning, text, delayMs: 145 }),
          metadata: { stage: "risks", branch: "parallel" },
        }
      }
      case SYNTHESIZE: {
        const research = payloadFromEvents(researchSchema, input.events)
        const risks = payloadFromEvents(risksSchema, input.events)
        const output = synthesisSchema.parse({
          objective: research.objective,
          summary: `${research.findings.length} findings converge with ${risks.risks.length} mitigated risks.`,
          recommendation: "Use event-scoped durable agents with explicit fan-out and fan-in.",
          evidenceCount: research.evidenceCount,
          riskCount: risks.risks.length,
        })
        const reasoning = "Combine both completed branch Events; neither branch is inferred from shared mutable state."
        const text = output.recommendation
        return {
          output,
          parts: [
            reasoningPart(reasoning),
            sourcePart(researchSource, risksSource),
            messagePart(text, output),
          ],
          stream: streamedParts({
            reasoning,
            text,
            sources: [researchSource, risksSource],
            delayMs: 70,
          }),
          metadata: { stage: "synthesis", fanIn: 2 },
        }
      }
      default:
        throw new Error(`reaction_chat_instruction_not_supported:${input.instruction}`)
    }
  },
})

export async function react({ input, contextKey }: ReactionChatInput) {
  const request = requestSchema.parse(input)
  const session = await Context(runtime).session(
    contextKey,
    reactionChatScope,
    reactionChatReactor,
    { sandbox: false },
  )

  const returnValue = (async () => {
    await using ownedSession = session
    const plan = await ownedSession
      .from(reactionChatDomain.events.requestReceived(request))
      .agent({ instruction: PLAN, output: planSchema, datasets: false })

    const [research, risks] = await Promise.all([
      ownedSession.from(plan).agent({
        instruction: RESEARCH,
        output: researchSchema,
        datasets: false,
      }),
      ownedSession.from(plan).agent({
        instruction: RISKS,
        output: risksSchema,
        datasets: false,
      }),
    ])

    const synthesis = await ownedSession.from([research, risks]).agent({
      instruction: SYNTHESIZE,
      output: synthesisSchema,
      datasets: false,
    })

    return await ownedSession.from(synthesis).action(
      reactionChatDomain.actions.publishReport,
      synthesis.payload,
    )
  })()

  return Object.freeze({
    contextId: session.context.id,
    sessionId: getSessionId(session),
    returnValue,
  })
}

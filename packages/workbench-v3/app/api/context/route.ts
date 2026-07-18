import { NextResponse } from "next/server"
import { start } from "workflow/api"

import { prepareAnswerMessage } from "@/src/chat-reaction"
import { workbenchScenarioSchema } from "@/src/domain"
import { answerMessageWorkflow } from "@/src/reaction.workflow"
import { ensureWorkbenchContext } from "@/src/runtime.server"

export const maxDuration = 300

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function message(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const latest = messages[messages.length - 1] as Record<string, unknown> | undefined
  const parts = Array.isArray(latest?.parts) ? latest.parts : []
  const value = parts.map(part => {
    if (!part || typeof part !== "object") return ""
    const row = part as Record<string, unknown>
    return text(row.text) || text((row.content as any)?.text)
  }).filter(Boolean).join("\n")
  return {
    id: text(latest?.id) || globalThis.crypto.randomUUID(),
    text: value || text(body.message),
    parts,
    scenario: workbenchScenarioSchema.catch("chat").parse(body.scenario),
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const input = message(body)
    if (!input.text) return NextResponse.json({ error: "message_required" }, { status: 400 })
    const state = await ensureWorkbenchContext(text(body.contextId) || undefined)
    const prepared = await prepareAnswerMessage({
      runtime: state.runtime,
      context: state.context,
      eventId: input.id,
      text: input.text,
      parts: input.parts,
      scenario: input.scenario,
    })
    const run = await start(answerMessageWorkflow, [prepared])
    return NextResponse.json({
      appId: state.appId,
      contextId: state.context.id,
      triggerId: prepared.trigger.id,
      workflowRunId: run.runId,
    }, { status: 202 })
  } catch (error) {
    console.error("[workbench-v3] Reaction request failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

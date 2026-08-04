import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import type { ContextEvent } from "../../packages/events/src/index.ts"

import type { ReactionChatInput, ReactionChatModule, ReactionChatRun } from "./contract.ts"

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function assertContextEvent(value: unknown): asserts value is ContextEvent {
  if (!isRecord(value)) throw new Error("reaction_chat_context_event_required")
  if (typeof value.id !== "string" || !value.id.trim()) {
    throw new Error("reaction_chat_context_event_id_required")
  }
  if (typeof value.type !== "string" || !value.type.trim()) {
    throw new Error("reaction_chat_context_event_type_required")
  }
  if (!(value.createdAt instanceof Date) || Number.isNaN(value.createdAt.valueOf())) {
    throw new Error("reaction_chat_context_event_created_at_required")
  }
  if (!("payload" in value)) {
    throw new Error("reaction_chat_context_event_payload_required")
  }
  if (!isRecord(value.links)) {
    throw new Error("reaction_chat_context_event_links_required")
  }
  if (!isRecord(value.physicalLinks)) {
    throw new Error("reaction_chat_context_event_physical_links_required")
  }
  if (!isRecord(value.metadata)) {
    throw new Error("reaction_chat_context_event_metadata_required")
  }
  if (!Array.isArray(value.eventParts)) {
    throw new Error("reaction_chat_context_event_parts_required")
  }
}

export async function loadReactionModule(modulePath: string): Promise<ReactionChatModule> {
  const absolutePath = resolve(modulePath)
  if (!absolutePath.endsWith(".ts")) {
    throw new Error(`reaction_chat_typescript_module_required:${absolutePath}`)
  }
  const moduleStat = await stat(absolutePath)
  if (!moduleStat.isFile()) {
    throw new Error(`reaction_chat_module_not_file:${absolutePath}`)
  }

  const moduleUrl = pathToFileURL(absolutePath)
  moduleUrl.searchParams.set("reactionChatMtime", String(Math.trunc(moduleStat.mtimeMs)))
  const loaded = await import(moduleUrl.href) as Partial<ReactionChatModule> & UnknownRecord

  if (typeof loaded.react !== "function") {
    throw new Error(
      `reaction_chat_named_export_required:${absolutePath}:export async function react(input)`,
    )
  }
  const unexpectedExports = Object.keys(loaded).filter((name) => name !== "react")
  if (unexpectedExports.length > 0) {
    throw new Error(
      `reaction_chat_unexpected_exports:${absolutePath}:${unexpectedExports.join(",")}`,
    )
  }

  return Object.freeze({ react: loaded.react })
}

function assertReactionChatRun(value: unknown): asserts value is ReactionChatRun {
  if (!isRecord(value)) throw new Error("reaction_chat_run_required")
  if (typeof value.contextId !== "string" || !value.contextId.trim()) {
    throw new Error("reaction_chat_run_context_id_required")
  }
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) {
    throw new Error("reaction_chat_run_session_id_required")
  }
  if (!isRecord(value.returnValue) && typeof value.returnValue !== "object") {
    throw new Error("reaction_chat_run_return_value_required")
  }
  if (typeof (value.returnValue as Promise<unknown>)?.then !== "function") {
    throw new Error("reaction_chat_run_return_value_promise_required")
  }
}

export async function startReactionTurn(input: Readonly<{
  modulePath: string
  input: unknown
  contextKey: string
}>) {
  const reaction = await loadReactionModule(input.modulePath)
  const startedAt = performance.now()
  const run = await reaction.react(Object.freeze({
    input: input.input,
    contextKey: input.contextKey,
  } satisfies ReactionChatInput))
  assertReactionChatRun(run)

  return Object.freeze({ run, startedAt })
}

export async function completeReactionTurn(started: Awaited<ReturnType<typeof startReactionTurn>>) {
  const event = await started.run.returnValue
  assertContextEvent(event)

  return Object.freeze({
    event,
    elapsedMs: Math.round(performance.now() - started.startedAt),
    contextId: started.run.contextId,
    sessionId: started.run.sessionId,
  })
}

export async function executeReactionTurn(input: Readonly<{
  modulePath: string
  input: unknown
  contextKey: string
}>) {
  return await completeReactionTurn(await startReactionTurn(input))
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

export function eventText(event: ContextEvent): string {
  for (const eventPart of [...event.eventParts].reverse()) {
    if (eventPart.type !== "message" || !isRecord(eventPart.content)) continue

    const text = eventPart.content.text
    if (typeof text === "string" && text.trim()) return text

    const blocks = eventPart.content.blocks
    if (!Array.isArray(blocks)) continue
    const rendered = blocks.flatMap((block) => {
      if (!isRecord(block)) return []
      if (block.type === "text" && typeof block.text === "string") return [block.text]
      if (block.type === "json") return [stringify(block.value)]
      return []
    }).filter(Boolean)
    if (rendered.length > 0) return rendered.join("\n")
  }

  if (isRecord(event.payload)) {
    for (const key of ["text", "message", "answer", "summary"] as const) {
      const value = event.payload[key]
      if (typeof value === "string" && value.trim()) return value
    }
  }

  return stringify(event.payload)
}

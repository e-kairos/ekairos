import type { ModelMessage } from "ai"
import type {
  ContextEvent,
  ContextEventPart,
  ContextRuntimeServiceHandle,
} from "@ekairos/events"

import type { ReactorInitialContext } from "./reactor.js"
import { toModelActionName } from "./action-name.js"

export function buildAgentSystemPrompt(input: {
  reactionKey: string
  instruction: string
  hasOutput: boolean
}) {
  return [
    `You are executing the reaction "${input.reactionKey}".`,
    input.instruction,
    "The messages are an explicit causal view: stable Context first, then selected Events in order, then the current instruction.",
    input.hasOutput
      ? "When finished, call respond exactly once with the requested structured output."
      : "Answer directly when the requested work is complete.",
  ].join("\n\n")
}

export async function buildAgentModelMessages<TContext>(input: {
  runtime: ContextRuntimeServiceHandle
  reactionKey: string
  instruction: string
  context: ReactorInitialContext<TContext>
  events: readonly ContextEvent[]
}): Promise<ModelMessage[]> {
  const messages: ModelMessage[] = [textMessage("user", renderContext(input.context))]
  for (const event of input.events) {
    messages.push(...await eventToModelMessages(input.runtime, event))
  }
  messages.push(textMessage("user", [
    "## Current reaction",
    "",
    `Definition: ${input.reactionKey}`,
    "",
    input.instruction,
  ].join("\n")))
  return messages
}

export async function eventToModelMessages(
  runtime: ContextRuntimeServiceHandle,
  event: ContextEvent,
): Promise<ModelMessage[]> {
  if (event.type === "context.action") {
    return actionPartsToModelMessages(event.eventParts)
  }
  const role = event.type === "context.model" ? "assistant" : "user"
  const content: any[] = [{ type: "text", text: renderEvent(event) }]
  appendMessageParts(content, event.eventParts)
  await appendLinkedFiles(runtime, content, event)

  const messages: ModelMessage[] = [{ role, content } as ModelMessage]
  messages.push(...actionPartsToModelMessages(event.eventParts))
  return messages
}

export function actionPartsToModelMessages(
  parts: readonly ContextEventPart[] | readonly { type: string; content: any }[],
  mapName: (name: string) => string = toModelActionName,
): ModelMessage[] {
  const started = new Map<string, { name: string; input: unknown; index: number }>()
  const settled = new Map<string, any>()
  parts.forEach((part, index) => {
    if (part.type !== "action") return
    const content = part.content as any
    if (content?.status === "started") {
      started.set(String(content.actionCallId), {
        name: String(content.actionName),
        input: content.input,
        index,
      })
    } else if (content?.actionCallId) {
      settled.set(String(content.actionCallId), content)
    }
  })

  return [...started.entries()]
    .sort((left, right) => left[1].index - right[1].index)
    .flatMap(([callId, call]) => {
      const toolName = mapName(call.name)
      const result = settled.get(callId)
      const assistant = {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: callId,
          toolName,
          input: call.input,
        }],
      } as unknown as ModelMessage
      const output = result?.status === "completed"
        ? { type: "json", value: jsonSafe(result.output) }
        : {
            type: "json",
            value: {
              ok: false,
              error: result?.error?.message ?? "Action did not complete.",
            },
          }
      const tool = {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: callId, toolName, output }],
      } as unknown as ModelMessage
      return [assistant, tool]
    })
}

function renderContext<TContext>(context: ReactorInitialContext<TContext>) {
  const lines = ["## Context", "", codeJson(context.content)]
  if (
    context.previous !== undefined &&
    stableJson(context.previous) !== stableJson(context.content)
  ) {
    lines.push("", "## Previous context", "", codeJson(context.previous))
  }
  return lines.join("\n")
}

function renderEvent(event: ContextEvent) {
  return [
    "## Event",
    "",
    codeJson({
      id: event.id,
      type: event.type,
      createdAt: event.createdAt.toISOString(),
      domain: event.domain,
      name: event.name,
      channel: event.channel,
      metadata: event.metadata,
      links: event.links,
      payload: event.payload,
    }),
  ].join("\n")
}

function appendMessageParts(content: any[], parts: readonly ContextEventPart[]) {
  for (const part of parts) {
    if (part.type !== "message") continue
    const value = part.content as any
    if (typeof value?.text === "string" && value.text) {
      content.push({ type: "text", text: value.text })
    }
    for (const block of value?.blocks ?? []) {
      if (block?.type === "text") content.push({ type: "text", text: block.text })
      if (block?.type === "json") {
        content.push({ type: "text", text: codeJson(block.value) })
      }
      if (block?.type === "file") appendFileBlock(content, block)
    }
  }
}

async function appendLinkedFiles(
  runtime: ContextRuntimeServiceHandle,
  content: any[],
  event: ContextEvent,
) {
  const ids: string[] = []
  for (const [alias, value] of Object.entries(event.links)) {
    if (event.physicalLinks[alias]?.target !== "$files") continue
    const values = Array.isArray(value) ? value : [value]
    ids.push(...values.filter((item): item is string => typeof item === "string"))
  }
  if (ids.length === 0) return
  const db = await runtime.db()
  for (const fileId of [...new Set(ids)]) {
    const result = await db.query({ $files: { $: { where: { id: fileId }, limit: 1 } } } as any)
    const file = result?.$files?.[0]
    if (!file) {
      content.push({ type: "text", text: fileHeader({ fileId, status: "missing" }) })
      continue
    }
    const mediaType = String(file["content-type"] ?? file.contentType ?? "application/octet-stream")
    const filename = String(file.path ?? file.name ?? fileId).split(/[\\/]/).pop() || fileId
    content.push({
      type: "text",
      text: fileHeader({
        fileId,
        filename,
        mediaType,
        size: typeof file.size === "number" ? file.size : undefined,
      }),
    })
    if (isTextMediaType(mediaType) && typeof file.url === "string") {
      const text = await readLinkedTextFile(file.url, file.size)
      if (text !== undefined) {
        content.push({
          type: "text",
          text: [
            "### File content",
            "",
            codeJson({ fileId, filename, mediaType }),
            "",
            text,
          ].join("\n"),
        })
      }
      continue
    }
    appendFileBlock(content, {
      type: "file",
      fileId,
      filename,
      mediaType,
      url: typeof file.url === "string" ? file.url : undefined,
    })
  }
}

const MAX_INLINE_TEXT_FILE_BYTES = 512 * 1_024

function isTextMediaType(mediaType: string) {
  return mediaType.startsWith("text/") || mediaType.includes("json")
}

async function readLinkedTextFile(url: string, size: unknown) {
  if (typeof size === "number" && size > MAX_INLINE_TEXT_FILE_BYTES) return undefined
  try {
    const response = await fetch(url)
    if (!response.ok) return undefined
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_INLINE_TEXT_FILE_BYTES) return undefined
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

function appendFileBlock(content: any[], file: any) {
  const mediaType = typeof file.mediaType === "string"
    ? file.mediaType
    : "application/octet-stream"
  const data = file.data ?? file.url
  if (!data) return
  if (mediaType.startsWith("image/")) {
    content.push({ type: "image", image: data, mediaType })
    return
  }
  if (
    mediaType === "application/pdf"
  ) {
    content.push({
      type: "file",
      data,
      mediaType,
      filename: file.filename,
    })
  }
}

function fileHeader(value: Record<string, unknown>) {
  return ["### File reference", "", codeJson(value)].join("\n")
}

function textMessage(role: "user" | "assistant", text: string): ModelMessage {
  return { role, content: [{ type: "text", text }] } as ModelMessage
}

function codeJson(value: unknown) {
  return `\`\`\`json\n${stableJson(value)}\n\`\`\``
}

function stableJson(value: unknown) {
  return JSON.stringify(sortJson(value), null, 2)
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== "object") return value
  if (value instanceof Date) return value.toISOString()
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  )
}

function jsonSafe(value: unknown) {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

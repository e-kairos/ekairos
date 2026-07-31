import "server-only"

import type { ContextHandle } from "@ekairos/context"
import { Events, Part } from "@ekairos/events"

import {
  workbenchDomain,
  type WorkbenchScenario,
} from "./domain"
import type { PreparedWorkbenchReaction } from "./reaction.input"
import type { WorkbenchRuntime } from "./runtime"
import { ensureWorkbenchSandbox } from "./runtime.server"

export async function prepareAnswerMessage(input: {
  runtime: WorkbenchRuntime
  context: ContextHandle<unknown> | null
  eventId: string
  text: string
  parts: readonly unknown[]
  scenario: WorkbenchScenario
}) {
  const context = input.context
  if (!context) throw new Error("workbench_context_not_found")
  const fileIds = await uploadInputFiles({ ...input, context })
  const draft = workbenchDomain.events.messageReceived({
    text: input.text,
    scenario: input.scenario,
  })
  const trigger = await Events(input.runtime).emit(
    fileIds.length > 0 ? draft.link({ files: [...fileIds] }) : draft,
    {
      id: input.eventId,
      channel: "web",
      contextId: context.id,
      parts: [Part.message({
        blocks: [{ type: "text", text: input.text }],
      })],
    },
  )
  const history = (await Events(input.runtime).query({
    $: {
      where: { context: context.id, domain: "workbench" },
      order: { createdAt: "asc" },
      limit: 200,
    },
  })).filter(event =>
    event.type === workbenchDomain.events.messageReceived.kind ||
    event.type === workbenchDomain.events.messageAnswered.kind ||
    event.type === workbenchDomain.events.reviewCompleted.kind)

  return Object.freeze({
    runtime: input.runtime,
    contextKey: requiredContextKey(context),
    trigger,
    history,
    scenario: input.scenario,
    ...(input.scenario === "review"
      ? {
          sandboxId: await ensureWorkbenchSandbox(input.runtime),
          repositoryUrl: repositoryURL(),
        }
      : {}),
  }) satisfies PreparedWorkbenchReaction
}

function requiredContextKey(context: ContextHandle<unknown>) {
  if (!context.key) throw new Error("workbench_context_key_required")
  return context.key
}

function repositoryURL() {
  return String(
    process.env.WORKBENCH_REPOSITORY_URL ??
      "https://github.com/octocat/Hello-World.git",
  ).trim()
}

async function uploadInputFiles(input: {
  runtime: WorkbenchRuntime
  context: ContextHandle<unknown>
  eventId: string
  text: string
  parts: readonly unknown[]
  scenario: WorkbenchScenario
}) {
  const files: Array<{ name: string; mediaType: string; bytes: Buffer }> = []
  for (const value of input.parts) {
    if (!value || typeof value !== "object") continue
    const part = value as Record<string, unknown>
    if (part.type !== "file") continue
    const url = typeof part.url === "string" ? part.url : ""
    if (!url) continue
    files.push({
      name: safeFileName(
        typeof part.filename === "string" ? part.filename : `attachment-${files.length + 1}`,
      ),
      mediaType: typeof part.mediaType === "string"
        ? part.mediaType
        : mediaTypeFromDataURL(url),
      bytes: await readInputFile(url),
    })
  }
  if (files.length === 0 && input.scenario === "review") {
    files.push({
      name: "request.md",
      mediaType: "text/markdown",
      bytes: Buffer.from(input.text, "utf8"),
    })
  }

  const db = await input.runtime.db()
  const ids: string[] = []
  for (const [index, file] of files.entries()) {
    const uploaded = await db.storage.uploadFile(
      `/workbench/${input.context.id}/incoming/${input.eventId}/${index}-${file.name}`,
      file.bytes,
      { contentType: file.mediaType, contentDisposition: file.name },
    )
    const fileId = String((uploaded as any)?.data?.id ?? "")
    if (!fileId) throw new Error(`workbench_file_upload_failed:${file.name}`)
    ids.push(fileId)
  }
  return Object.freeze(ids)
}

async function readInputFile(url: string) {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",")
    if (comma < 0) throw new Error("workbench_file_data_url_invalid")
    const metadata = url.slice(5, comma)
    const data = url.slice(comma + 1)
    return metadata.includes(";base64")
      ? Buffer.from(data, "base64")
      : Buffer.from(decodeURIComponent(data), "utf8")
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`workbench_file_fetch_failed:${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function mediaTypeFromDataURL(url: string) {
  return /^data:([^;,]+)/.exec(url)?.[1] ?? "application/octet-stream"
}

function safeFileName(value: string) {
  const name = value.replace(/\\/g, "/").split("/").pop() ?? "file"
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-") || "file"
}

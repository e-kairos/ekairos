import type { ReactionEngineStreamEmission } from "../reactor.js"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function common(
  chunk: Record<string, unknown>,
  round: number,
): Pick<ReactionEngineStreamEmission, "round" | "provider" | "providerType" | "raw"> {
  return {
    round,
    provider: "ai-sdk",
    providerType: text(chunk.type) ?? "unknown",
    raw: chunk,
  }
}

export function mapAiSdkStreamChunk(
  value: unknown,
  round: number,
): ReactionEngineStreamEmission {
  const chunk = record(value)
  const type = text(chunk.type) ?? "unknown"
  const base = common(chunk, round)
  const partId = text(chunk.id)
  const actionCallId = text(chunk.toolCallId) ?? partId
  const actionName = text(chunk.toolName) ?? text(chunk.name)

  if (type === "start-step") {
    return { ...base, kind: "model.round.started", data: chunk }
  }
  if (type === "finish-step") {
    return { ...base, kind: "model.round.completed", data: chunk }
  }
  if (type === "text-delta") {
    return {
      ...base,
      kind: "text.delta",
      ...(partId ? { partId } : {}),
      delta: text(chunk.text) ?? text(chunk.delta) ?? text(chunk.textDelta) ?? "",
    }
  }
  if (type === "reasoning-delta") {
    return {
      ...base,
      kind: "reasoning.delta",
      ...(partId ? { partId } : {}),
      delta: text(chunk.text) ?? text(chunk.delta) ?? text(chunk.textDelta) ?? "",
    }
  }
  if (type === "reasoning-end") {
    return {
      ...base,
      kind: "reasoning.completed",
      ...(partId ? { partId } : {}),
    }
  }
  if (type === "tool-input-delta" || type === "tool-call-delta") {
    return {
      ...base,
      kind: "action.input.delta",
      actionCallId: actionCallId ?? `round-${round}-unknown-action`,
      ...(actionName ? { actionName } : {}),
      delta: text(chunk.delta) ?? text(chunk.inputTextDelta) ?? text(chunk.argsTextDelta) ?? "",
    }
  }
  if (
    type === "tool-input-start" ||
    type === "tool-call-start" ||
    type === "tool-input-available" ||
    type === "tool-call"
  ) {
    return {
      ...base,
      kind: "action.started",
      actionCallId: actionCallId ?? `round-${round}-unknown-action`,
      ...(actionName ? { actionName } : {}),
      input: chunk.input ?? chunk.args ?? {},
    }
  }
  if (type === "tool-output-available") {
    return {
      ...base,
      kind: "action.completed",
      actionCallId: actionCallId ?? `round-${round}-unknown-action`,
      ...(actionName ? { actionName } : {}),
      output: chunk.output,
    }
  }
  if (type === "tool-output-error") {
    return {
      ...base,
      kind: "action.failed",
      actionCallId: actionCallId ?? `round-${round}-unknown-action`,
      ...(actionName ? { actionName } : {}),
      error: chunk.error ?? { message: "Action failed." },
    }
  }
  if (type === "source-url") {
    return {
      ...base,
      kind: "source.available",
      data: {
        source: {
          type: "source-url",
          sourceId: text(chunk.sourceId) ?? partId ?? `source-${round}`,
          url: text(chunk.url) ?? "",
          ...(text(chunk.title) ? { title: text(chunk.title) } : {}),
        },
      },
    }
  }
  if (type === "source-document") {
    return {
      ...base,
      kind: "source.available",
      data: {
        source: {
          type: "source-document",
          sourceId: text(chunk.sourceId) ?? partId ?? `source-${round}`,
          mediaType: text(chunk.mediaType) ?? "application/octet-stream",
          title: text(chunk.title) ?? text(chunk.filename) ?? "Document",
          ...(text(chunk.filename) ? { filename: text(chunk.filename) } : {}),
        },
      },
    }
  }
  if (type === "error") {
    return { ...base, kind: "provider.error", error: chunk.error ?? chunk }
  }
  return { ...base, kind: "provider.event", data: chunk }
}

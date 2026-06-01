import type { ContextItem } from "@ekairos/events"
import { SANDBOX_EXECUTE_COMMAND_ACTION_NAME } from "@ekairos/sandbox/contract"
export type AnyRecord = Record<string, unknown>

export type CodexDynamicActionDetails = {
  actionCallId?: string
  actionName?: string
  input?: unknown
  output?: unknown
  success?: boolean
  errorText?: string
  providerThreadId?: string
  providerTurnId?: string
  providerResponse?: AnyRecord
}

export function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

export function asRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== "object") return {}
  return value as AnyRecord
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function cleanRecord(value: AnyRecord): AnyRecord {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asString(value).trim()
    if (text) return text
  }
  return undefined
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) return value
  }
  return undefined
}

function parseJsonText(value: string): { parsed: true; value: unknown } | { parsed: false; value: string } {
  const text = value.trim()
  if (!text) return { parsed: false, value }
  if (!/^[\[{"]|^-?\d|^(true|false|null)$/i.test(text)) return { parsed: false, value }
  try {
    return { parsed: true, value: JSON.parse(text) }
  } catch {
    return { parsed: false, value }
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value
  const parsed = parseJsonText(value)
  return parsed.parsed ? parsed.value : value
}

export function readCodexDynamicActionDetails(params: AnyRecord): CodexDynamicActionDetails {
  const item = asRecord(params.item)
  const result = asRecord(params.result)
  const turn = asRecord(params.turn)
  const error = asRecord(params.error)
  const resultError = asRecord(result.error)
  const itemError = asRecord(item.error)
  const actionCallId = firstString(
    params.callId,
    params.toolCallId,
    params.itemId,
    params.id,
    item.callId,
    item.toolCallId,
    item.itemId,
    item.id,
  )
  const actionName = firstString(
    params.actionName,
    params.tool,
    params.toolName,
    params.name,
    item.actionName,
    item.tool,
    item.toolName,
    item.name,
  )
  const input = parseMaybeJson(
    firstDefined(params.arguments, params.input, params.args, item.arguments, item.input, item.args),
  )
  const output = parseMaybeJson(
    firstDefined(params.output, result.output, result.value, result.contentItems, item.output, item.result),
  )
  const errorText = firstString(
    params.errorText,
    params.error,
    error.message,
    result.errorText,
    result.error,
    resultError.message,
    item.errorText,
    item.error,
    itemError.message,
  )
  const explicitSuccess = firstDefined(params.success, result.success, item.success)
  const success =
    explicitSuccess === false || errorText
      ? false
      : explicitSuccess === true
        ? true
        : undefined

  return cleanRecord({
    actionCallId,
    actionName,
    input,
    output,
    success,
    errorText,
    providerThreadId: firstString(params.threadId, item.threadId, turn.threadId),
    providerTurnId: firstString(params.turnId, item.turnId, turn.id),
    providerResponse: Object.keys(result).length > 0 ? result : undefined,
  }) as CodexDynamicActionDetails
}

function codexProviderMetadata(params: {
  source: string
  sequence: number
  at?: string
  providerThreadId?: string
  providerTurnId?: string
  providerItemId?: string
  providerToolType?: string
  success?: boolean
  response?: unknown
  errorText?: string
}) {
  return cleanRecord({
    source: params.source,
    sequence: params.sequence,
    at: params.at ?? "",
    provider: {
      codex: cleanRecord({
        threadId: params.providerThreadId,
        turnId: params.providerTurnId,
        itemId: params.providerItemId,
        toolType: params.providerToolType,
        success: params.success,
        response: params.response,
        errorText: params.errorText,
      }),
    },
  })
}

function normalizeSandboxRunStatus(status: string, exitCode?: number): string {
  const normalized = status.trim().toLowerCase()
  if (normalized === "failed" || (typeof exitCode === "number" && exitCode !== 0)) return "failed"
  if (normalized === "cancelled" || normalized === "canceled") return "killed"
  if (normalized === "running" || normalized === "in_progress") return "running"
  if (normalized === "detached") return "detached"
  return "exited"
}

function normalizeCodexToolOutputContent(value: unknown): AnyRecord[] {
  if (value === undefined || value === null) return []
  if (typeof value === "string") {
    const parsed = parseJsonText(value)
    return parsed.parsed ? [{ type: "json", value: parsed.value }] : [{ type: "text", text: value }]
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeCodexToolOutputContent(entry))
  }

  const record = asRecord(value)
  if (!record || Object.keys(record).length === 0) {
    return [{ type: "json", value }]
  }

  if (Array.isArray(record.contentItems)) {
    return record.contentItems.flatMap((entry) => normalizeCodexToolOutputContent(entry))
  }

  if (
    record.type === "inputText" ||
    record.type === "outputText" ||
    record.type === "text" ||
    record.type === "input_text"
  ) {
    const text = asString(record.text || record.input_text)
    if (!text) return []
    const parsed = parseJsonText(text)
    return parsed.parsed ? [{ type: "json", value: parsed.value }] : [{ type: "text", text }]
  }

  if (record.type === "content" && Array.isArray(record.value)) {
    const out: AnyRecord[] = []
    for (const entry of record.value) {
      const block = asRecord(entry)
      if (block.type === "text" && typeof block.text === "string") {
        out.push({ type: "text", text: block.text })
        continue
      }
      if (block.type === "image-data") {
        out.push(
          cleanRecord({
            type: "file",
            mediaType: asString(block.mediaType) || "application/octet-stream",
            filename: asString(block.filename) || undefined,
            data: typeof block.data === "string" ? block.data : undefined,
          }),
        )
        continue
      }
      if (block.type === "file") {
        out.push(
          cleanRecord({
            type: "file",
            mediaType: asString(block.mediaType) || "application/octet-stream",
            filename: asString(block.filename) || undefined,
            data: typeof block.data === "string" ? block.data : undefined,
            url: typeof block.url === "string" ? block.url : undefined,
            fileId: typeof block.fileId === "string" ? block.fileId : undefined,
          }),
        )
        continue
      }
      out.push({ type: "json", value: entry })
    }
    return out
  }

  if (record.type === "file") {
    return [
      cleanRecord({
        type: "file",
        mediaType: asString(record.mediaType) || "application/octet-stream",
        filename: asString(record.filename) || undefined,
        data: typeof record.data === "string" ? record.data : undefined,
        url: typeof record.url === "string" ? record.url : undefined,
        fileId: typeof record.fileId === "string" ? record.fileId : undefined,
      }),
    ]
  }

  return [{ type: "json", value }]
}

function normalizeCodexToolErrorContent(output: AnyRecord, response: AnyRecord): AnyRecord[] {
  const errorText =
    asString(output.errorText) ||
    asString(asRecord(output.output).error) ||
    asString(asRecord(response).error) ||
    "Tool execution failed."
  return [{ type: "text", text: errorText }]
}

function codexContentBlocksToActionValue(blocks: AnyRecord[]) {
  if (blocks.length === 0) return undefined
  if (blocks.length === 1) {
    const first = blocks[0]
    if (first.type === "json") return first.value
    if (first.type === "text") return first.text
    if (first.type === "file") return first
  }

  return {
    type: "content",
    value: blocks,
  }
}

function codexContentBlocksToErrorText(blocks: AnyRecord[]) {
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => asString(block.text))
    .filter(Boolean)
    .join("\n\n")
    .trim()
  if (text) return text

  const jsonBlock = blocks.find((block) => block.type === "json")
  if (jsonBlock) return JSON.stringify(jsonBlock.value, null, 2)

  return ""
}

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  const out: string[] = []
  for (const part of parts) {
    const record = asRecord(part)
    const partType = asString(record.type)
    if (partType === "text") {
      const value = asString(record.text).trim()
      if (value) out.push(value)
      continue
    }
    if (partType === "input_text") {
      const value = asString(record.input_text || record.text).trim()
      if (value) out.push(value)
      continue
    }
    const inline = asString(record.text).trim()
    if (inline) out.push(inline)
  }
  return out.join("\n").trim()
}

export function defaultInstructionFromTrigger(event: ContextItem): string {
  const content = asRecord(event.content)
  const message = textFromParts(content.parts)
  return message || "Continue with the current task."
}

export function buildCodexParts(params: {
  toolName: string
  includeReasoningPart: boolean
  completedOnly?: boolean
  semanticChunks?: unknown[]
  rawChunks?: unknown[]
  result: {
    providerContextId: string
    turnId: string
    assistantText: string
    reasoningText?: string
    diff?: string
    toolParts?: unknown[]
    metadata?: Record<string, unknown>
  }
  instruction: string
  streamTrace?: unknown
}) {
  const parts: Array<{ sequence: number; part: AnyRecord }> = []
  const streamTrace = asRecord(params.streamTrace)
  const capturedChunks =
    asArray<AnyRecord>(params.rawChunks).length > 0
      ? asArray<AnyRecord>(params.rawChunks)
      : asArray<AnyRecord>(params.semanticChunks).length > 0
        ? asArray<AnyRecord>(params.semanticChunks)
        : asArray<AnyRecord>(streamTrace.chunks)
  const semanticChunks =
    asArray<AnyRecord>(params.semanticChunks).length > 0
      ? asArray<AnyRecord>(params.semanticChunks)
      : asArray<AnyRecord>(streamTrace.chunks)

  const lastChunkSequence = capturedChunks.reduce((max, chunk) => {
    const sequence = typeof chunk.sequence === "number" ? chunk.sequence : 0
    return Math.max(max, sequence)
  }, 0)

  function findLastChunk(
    predicate: (chunk: AnyRecord) => boolean,
  ): { sequence: number; at: string } | null {
    for (let index = capturedChunks.length - 1; index >= 0; index -= 1) {
      const chunk = capturedChunks[index]
      if (!predicate(chunk)) continue
      return {
        sequence: typeof chunk.sequence === "number" ? chunk.sequence : 0,
        at: asString(chunk.at),
      }
    }
    return null
  }

  const turnCompletedChunk = findLastChunk((chunk) => {
    const data = asRecord(chunk.data)
    const method = asString(data.method)
    return method === "turn/completed"
  })

  const completedAgentMessages = semanticChunks
    .map((chunk) => {
      const data = asRecord(chunk.data)
      const method = asString(data.method)
      const paramsRecord = asRecord(data.params)
      const item = asRecord(paramsRecord.item)
      if (method !== "item/completed" || asString(item.type) !== "agentMessage") return null
      const text = asString(item.text).trim()
      if (!text) return null
      return {
        sequence: typeof chunk.sequence === "number" ? chunk.sequence : 0,
        at: asString(chunk.at),
        itemId: asString(item.id),
        text,
      }
    })
    .filter(Boolean) as Array<{ sequence: number; at: string; itemId: string; text: string }>

  const reasoningFromStream = capturedChunks
    .filter((chunk) => {
      const data = asRecord(chunk.data)
      const method = asString(data.method)
      return method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta"
    })
    .map((chunk) => asString(asRecord(asRecord(chunk.data).params).delta))
    .join("")
    .trim()
  const completedReasoningItems = semanticChunks
    .map((chunk) => {
      const data = asRecord(chunk.data)
      const method = asString(data.method)
      const paramsRecord = asRecord(data.params)
      const item = asRecord(paramsRecord.item)
      if (method !== "item/completed" || asString(item.type) !== "reasoning") return null
      const text = asString(item.summary || item.text).trim()
      if (!text) return null
      return {
        sequence: typeof chunk.sequence === "number" ? chunk.sequence : 0,
        at: asString(chunk.at),
        itemId: asString(item.id),
        text,
      }
    })
    .filter(Boolean) as Array<{ sequence: number; at: string; itemId: string; text: string }>

  for (const message of completedAgentMessages) {
    if (params.completedOnly === true || params.completedOnly === false || params.completedOnly === undefined) {
      parts.push({
        sequence: message.sequence,
        part: {
          type: "text",
          text: message.text,
          metadata: {
            source: "codex.timeline",
            sequence: message.sequence,
            at: message.at,
            itemId: message.itemId,
          },
        },
      })
    }
  }

  if (params.includeReasoningPart && reasoningFromStream) {
    const lastReasoningChunk = findLastChunk((chunk) => {
      const data = asRecord(chunk.data)
      const method = asString(data.method)
      return method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta"
    })
    parts.push({
      sequence: lastReasoningChunk?.sequence ?? lastChunkSequence + 1,
      part: {
        type: "reasoning",
        text: reasoningFromStream,
        metadata: {
          source: "codex.timeline.full",
          sequence: lastReasoningChunk?.sequence ?? lastChunkSequence + 1,
          at: lastReasoningChunk?.at ?? "",
        },
      },
    })
  } else if (params.includeReasoningPart) {
    for (const reasoningItem of completedReasoningItems) {
      parts.push({
        sequence: reasoningItem.sequence,
        part: {
          type: "reasoning",
          text: reasoningItem.text,
          metadata: {
            source: "codex.timeline",
            sequence: reasoningItem.sequence,
            at: reasoningItem.at,
            itemId: reasoningItem.itemId,
          },
        },
      })
    }
  }

  const commands = new Map<
    string,
    {
      input?: AnyRecord
      outputText?: string
      completed?: AnyRecord
      sequence?: number
      at?: string
    }
  >()
  const dynamicTools = new Map<
    string,
    {
      input?: AnyRecord
      output?: AnyRecord
      actionName?: string
      actionInput?: unknown
      actionOutput?: unknown
      success?: boolean
      errorText?: string
      providerThreadId?: string
      providerTurnId?: string
      providerResponse?: AnyRecord
      sequence?: number
      at?: string
    }
  >()

  for (const chunk of capturedChunks) {
    const data = asRecord(chunk.data)
    const method = asString(data.method)
    const paramsRecord = asRecord(data.params)
    if (method === "item/tool/call") {
      const actionDetails = readCodexDynamicActionDetails(paramsRecord)
      const toolCallId = asString(actionDetails.actionCallId)
      if (toolCallId) {
        dynamicTools.set(toolCallId, {
          ...(dynamicTools.get(toolCallId) ?? {}),
          input: paramsRecord,
          actionName: actionDetails.actionName,
          actionInput: actionDetails.input,
          providerThreadId: actionDetails.providerThreadId,
          providerTurnId: actionDetails.providerTurnId,
          sequence:
            typeof chunk.sequence === "number" ? chunk.sequence : undefined,
          at: asString(chunk.at),
        })
      }
      continue
    }
    if (method === "item/tool/result") {
      const actionDetails = readCodexDynamicActionDetails(paramsRecord)
      const toolCallId = asString(actionDetails.actionCallId)
      if (toolCallId) {
        const current = dynamicTools.get(toolCallId) ?? {}
        current.output = paramsRecord
        current.actionName = current.actionName || actionDetails.actionName
        current.actionOutput = actionDetails.output
        current.success = actionDetails.success
        current.errorText = actionDetails.errorText
        current.providerThreadId = current.providerThreadId || actionDetails.providerThreadId
        current.providerTurnId = current.providerTurnId || actionDetails.providerTurnId
        current.providerResponse = actionDetails.providerResponse
        current.sequence =
          typeof chunk.sequence === "number"
            ? Math.max(current.sequence ?? 0, chunk.sequence)
            : current.sequence
        current.at = asString(chunk.at) || current.at
        dynamicTools.set(toolCallId, current)
      }
      continue
    }
    if (method === "item/started") {
      const item = asRecord(paramsRecord.item)
      if (asString(item.type) === "commandExecution") {
        commands.set(asString(item.id), {
          ...(commands.get(asString(item.id)) ?? {}),
          input: item,
          sequence:
            typeof chunk.sequence === "number" ? chunk.sequence : undefined,
          at: asString(chunk.at),
        })
      }
      continue
    }
    if (method === "item/commandExecution/outputDelta") {
      const itemId = asString(paramsRecord.itemId)
      if (!itemId) continue
      const current = commands.get(itemId) ?? {}
      current.outputText = `${current.outputText ?? ""}${asString(paramsRecord.delta)}`
      current.sequence =
        typeof chunk.sequence === "number"
          ? Math.max(current.sequence ?? 0, chunk.sequence)
          : current.sequence
      current.at = asString(chunk.at) || current.at
      commands.set(itemId, current)
      continue
    }
    if (method === "item/completed") {
      const item = asRecord(paramsRecord.item)
      if (asString(item.type) === "commandExecution") {
        const itemId = asString(item.id)
        const current = commands.get(itemId) ?? {}
        current.completed = item
        current.sequence =
          typeof chunk.sequence === "number"
            ? Math.max(current.sequence ?? 0, chunk.sequence)
            : current.sequence
        current.at = asString(chunk.at) || current.at
        commands.set(itemId, current)
      }
    }
  }

  if (completedAgentMessages.length === 0) {
    const assistantText = asString(params.result.assistantText).trim()
    if (assistantText && !params.completedOnly) {
      parts.push({
        sequence: lastChunkSequence + 1,
        part: {
          type: "text",
          text: assistantText,
          metadata: {
            source: "codex.timeline.fallback",
            sequence: lastChunkSequence + 1,
            at: "",
          },
        },
      })
    }
  }

  if (
    params.includeReasoningPart &&
    !reasoningFromStream &&
    completedReasoningItems.length === 0
  ) {
    const reasoningText = asString(params.result.reasoningText || reasoningFromStream).trim()
    if (reasoningText && !params.completedOnly) {
      parts.push({
        sequence: lastChunkSequence + 1,
        part: {
          type: "reasoning",
          text: reasoningText,
          metadata: {
            source: "codex.timeline.fallback",
            sequence: lastChunkSequence + 1,
            at: "",
          },
        },
      })
    }
  }

  for (const [toolCallId, command] of commands.entries()) {
    const input = asRecord(command.input)
    const completed = asRecord(command.completed)
    const outputText = asString(completed.aggregatedOutput || command.outputText).trim()
    const status = asString(completed.status || input.status || "completed").trim()
    const exitCode =
      typeof completed.exitCode === "number" ? completed.exitCode : undefined
    const resultMetadata = asRecord(params.result.metadata)
    const sandboxMetadata = asRecord(resultMetadata.sandbox)
    const commandProcesses = asRecord(sandboxMetadata.commandProcesses)
    const commandProcess = asRecord(commandProcesses[toolCallId])
    const sandboxId = asString(sandboxMetadata.sandboxId).trim()
    const commandText = asString(input.command)
    const failed = status === "failed" || (typeof exitCode === "number" && exitCode !== 0)
    const errorText =
      status === "failed"
        ? asString(completed.error || completed.message || "command_execution_failed")
        : undefined
    const sandboxStatus = normalizeSandboxRunStatus(status, exitCode)
    const reactorMetadata = cleanRecord({
      reactorKind: "codex",
      ...codexProviderMetadata({
        source: "codex.timeline",
        sequence: command.sequence ?? 0,
        at: command.at,
        providerItemId: toolCallId,
        providerToolType: "commandExecution",
        success: !failed,
        response: cleanRecord({
          startedItem: input,
          completedItem: command.completed ? completed : undefined,
          outputText: outputText || undefined,
        }),
        errorText,
      }),
    })
    parts.push({
      sequence: command.sequence ?? 0,
      part: {
        type: "action",
        content: {
          status: "started",
          actionName: SANDBOX_EXECUTE_COMMAND_ACTION_NAME,
          actionCallId: toolCallId,
          input: cleanRecord({
            command: commandText,
            args: [],
            cwd: asString(input.cwd) || undefined,
            kind: "command",
            mode: "foreground",
            metadata: cleanRecord({
              source: "codex.commandExecution",
              commandActions: asArray(input.commandActions),
            }),
          }),
        },
        reactorMetadata,
      },
    })
    if (!command.completed) continue
    parts.push({
      sequence: (command.sequence ?? 0) + 0.1,
      part: {
        type: "action",
        content: {
          status: "completed",
          actionName: SANDBOX_EXECUTE_COMMAND_ACTION_NAME,
          actionCallId: toolCallId,
          output: cleanRecord({
            sandboxId: sandboxId || undefined,
            processId: asString(commandProcess.processId) || undefined,
            streamId: asString(commandProcess.streamId) || undefined,
            streamClientId: asString(commandProcess.streamClientId) || undefined,
            success: !failed,
            exitCode,
            output: outputText || undefined,
            error: failed ? errorText : undefined,
            command: commandText || undefined,
            durationMs:
              typeof completed.durationMs === "number" ? completed.durationMs : undefined,
            status: sandboxStatus,
          }),
        },
        reactorMetadata,
      },
    })
  }

  for (const [toolCallId, toolCall] of dynamicTools.entries()) {
    const input = asRecord(toolCall.input)
    const output = asRecord(toolCall.output)
    const result = asRecord(output.result)
    const inputDetails = readCodexDynamicActionDetails(input)
    const outputDetails = readCodexDynamicActionDetails(output)
    const toolName =
      asString(toolCall.actionName).trim() ||
      asString(outputDetails.actionName).trim() ||
      asString(inputDetails.actionName).trim() ||
      "dynamicTool"
    const success =
      toolCall.success ??
      outputDetails.success ??
      (result.success !== false && !asString(output.errorText))
    const callSequence = toolCall.sequence ?? 0
    const providerThreadId =
      toolCall.providerThreadId || inputDetails.providerThreadId || outputDetails.providerThreadId
    const providerTurnId =
      toolCall.providerTurnId || inputDetails.providerTurnId || outputDetails.providerTurnId
    const providerResponse =
      toolCall.providerResponse || outputDetails.providerResponse || (Object.keys(result).length > 0 ? result : undefined)
    const startedReactorMetadata = cleanRecord({
      reactorKind: "codex",
      ...codexProviderMetadata({
        source: "codex.dynamic_tool",
        sequence: callSequence,
        at: toolCall.at,
        providerThreadId,
        providerTurnId,
        providerItemId: toolCallId,
        providerToolType: "dynamicTool",
      }),
    })

    parts.push({
      sequence: callSequence,
      part: {
        type: "action",
        content: {
          status: "started",
          actionName: toolName,
          actionCallId: toolCallId,
          input: toolCall.actionInput ?? inputDetails.input ?? {},
        },
        reactorMetadata: startedReactorMetadata,
      },
    })
    if (toolCall.output) {
      const actionOutput =
        toolCall.actionOutput ??
        outputDetails.output ??
        firstDefined(
          output.output,
          result.output,
          result.contentItems,
          Object.keys(result).length > 0 ? result : undefined,
        )
      const resultBlocks = success
        ? normalizeCodexToolOutputContent(actionOutput)
        : normalizeCodexToolErrorContent(output, result)
      const resultReactorMetadata = cleanRecord({
        reactorKind: "codex",
        ...codexProviderMetadata({
          source: "codex.dynamic_tool",
          sequence: callSequence,
          at: toolCall.at,
          providerThreadId,
          providerTurnId,
          providerItemId: toolCallId,
          providerToolType: "dynamicTool",
          success,
          response: providerResponse,
          errorText: toolCall.errorText || outputDetails.errorText || asString(output.errorText) || undefined,
        }),
      })

      parts.push({
        sequence: callSequence + 0.1,
        part: {
          type: "action",
          content: success
            ? {
                status: "completed",
                actionName: toolName,
                actionCallId: toolCallId,
                output: codexContentBlocksToActionValue(resultBlocks),
              }
            : {
                status: "failed",
                actionName: toolName,
                actionCallId: toolCallId,
                error: {
                  message:
                    codexContentBlocksToErrorText(resultBlocks) || "Action execution failed.",
                },
              },
          reactorMetadata: resultReactorMetadata,
        },
      })
    }
  }

  const tokenUsageChunk = [...semanticChunks]
    .reverse()
    .find((chunk) => {
      const data = asRecord(chunk.data)
      const method = asString(data.method)
      return method === "thread/tokenUsage/updated" || method === "context/tokenUsage/updated"
    })
  const tokenUsage = tokenUsageChunk
    ? asRecord(asRecord(asRecord(tokenUsageChunk.data).params).tokenUsage)
    : {}

  if (!params.completedOnly || turnCompletedChunk) {
    parts.push({
      sequence: turnCompletedChunk?.sequence ?? lastChunkSequence + 1,
      part: {
        type: "tool-turnMetadata",
        toolName: "turnMetadata",
        toolCallId: params.result.turnId || params.result.providerContextId,
        state: "output-available",
        input: { instruction: params.instruction },
        output: {
          providerContextId: params.result.providerContextId,
          turnId: params.result.turnId,
          diff: params.result.diff ?? "",
          tokenUsage,
          streamTrace: params.streamTrace,
          ...(params.result.metadata ?? {}),
        },
        metadata: {
          source: "codex.timeline",
          sequence: turnCompletedChunk?.sequence ?? lastChunkSequence + 1,
          at: turnCompletedChunk?.at ?? "",
        },
      },
    })
  }

  return parts
    .sort((a, b) => a.sequence - b.sequence)
    .map((entry) => entry.part)
}


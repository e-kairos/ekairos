import { randomUUID } from "node:crypto"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Box, Text, useApp, useInput, useStdout } from "ink"
import TextInput from "ink-text-input"

import {
  createSessionLogDb,
  logSession,
  type ContextEvent,
} from "../../packages/events/src/index.ts"
import type { CliOptions } from "./args.ts"
import type { ReactionChatInstantApp } from "./instant-app.ts"
import { createReactionChatInstantApp } from "./instant-app.ts"
import {
  completeReactionTurn,
  startReactionTurn,
} from "./reaction-module.ts"
import {
  emptyReactionGraph,
  projectSessionTimeline,
  reduceSessionLog,
  type ReactionGraphState,
} from "./reaction-view.ts"
import { buildTimelineRail } from "./timeline-rail.ts"
import { createReactionNavigator } from "./reaction-navigator.ts"
import {
  limitRowLines,
  selectCenteredTerminalViewport,
  selectTerminalViewport,
} from "./terminal-viewport.ts"

type Phase = "provisioning" | "ready" | "running" | "completed" | "failed"

type RunOutput = Readonly<{
  event: ContextEvent
  elapsedMs: number
  contextId: string
  sessionId: string
}>

function shortId(value: unknown): string {
  return typeof value === "string" && value ? value.slice(0, 8) : "pending"
}

function compact(value: unknown, limit = 110): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value)
  if (!serialized) return ""
  return serialized.length <= limit ? serialized : `${serialized.slice(0, limit - 1)}…`
}

function pretty(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2) ?? String(value)
}

function statusColor(status: unknown): "green" | "red" | "yellow" | "gray" {
  if (status === "completed") return "green"
  if (status === "failed") return "red"
  if (status === "running") return "yellow"
  return "gray"
}

function Status({ value }: { value: unknown }) {
  const status = typeof value === "string" ? value : "pending"
  const symbol = status === "completed" ? "●" : status === "failed" ? "×" : "◌"
  return <Text color={statusColor(status)}>{symbol} {status}</Text>
}

type TimelineLine = Readonly<{
  text: string
  color?: "blue" | "cyan" | "gray" | "white" | "yellow" | "red"
  bold?: boolean
  dim?: boolean
}>

function clipped(value: string, width: number): string {
  if (width <= 0) return ""
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`
}

function column(value: string, width: number): string {
  return clipped(value, width).padEnd(width)
}

function wrap(value: string, width: number): readonly string[] {
  const size = Math.max(1, width)
  const lines: string[] = []
  for (const source of value.replace(/\r/g, "").split("\n")) {
    if (!source) {
      lines.push("")
      continue
    }
    for (let offset = 0; offset < source.length; offset += size) {
      lines.push(source.slice(offset, offset + size))
    }
  }
  return lines
}

function limitedPretty(value: unknown, width: number, maxLines: number): string {
  if (maxLines <= 1) return clipped(serialized(value), width)
  const lines = wrap(pretty(value), width)
  if (lines.length <= maxLines) return lines.join("\n")
  return [
    ...lines.slice(0, Math.max(0, maxLines - 1)),
    `… ${lines.length - maxLines + 1} more lines`,
  ].join("\n")
}

function timelineEventSummary(event: {
  payload: unknown
  eventParts: readonly { type: string; content: unknown }[]
}): string {
  if (typeof event.payload === "string") return event.payload
  if (event.payload && typeof event.payload === "object") {
    const payload = event.payload as Record<string, unknown>
    for (const key of ["text", "summary", "message"] as const) {
      if (typeof payload[key] === "string") return payload[key]
    }
  }
  for (const part of [...event.eventParts].reverse()) {
    if (!part.content || typeof part.content !== "object") continue
    const content = part.content as Record<string, unknown>
    if (part.type === "message" && typeof content.text === "string") return content.text
    if (part.type === "action" && typeof content.actionName === "string") {
      return `${content.actionName}${typeof content.status === "string" ? ` · ${content.status}` : ""}`
    }
  }
  return event.payload && typeof event.payload === "object" ? compact(event.payload) : ""
}

function serialized(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value) ?? String(value)
}

type PartContentRow = Readonly<{ label: string; text: string }>

function eventPartContentRows(part: { type: string; content: unknown }): readonly PartContentRow[] {
  if (!part.content || typeof part.content !== "object") {
    return [{ label: part.type, text: serialized(part.content) }]
  }
  const content = part.content as Record<string, unknown>
  if (part.type === "message") {
    const rows: PartContentRow[] = []
    if (typeof content.text === "string") rows.push({ label: "message", text: content.text })
    if (Array.isArray(content.blocks)) {
      for (const block of content.blocks) {
        if (!block || typeof block !== "object") continue
        const value = block as Record<string, unknown>
        if (value.type === "json") rows.push({ label: "json", text: pretty(value.value) })
        if (value.type === "text" && typeof value.text === "string") {
          rows.push({ label: "text", text: value.text })
        }
        if (value.type === "file") {
          rows.push({
            label: "file",
            text: [value.filename, value.mediaType, value.fileId ?? value.url]
              .filter(Boolean)
              .join(" · "),
          })
        }
      }
    }
    return rows.length > 0 ? rows : [{ label: "message", text: serialized(content) }]
  }
  if (part.type === "reasoning" && typeof content.text === "string") {
    return [{ label: "reasoning", text: content.text }]
  }
  if (part.type === "source" && Array.isArray(content.sources)) {
    return content.sources.map(source => {
      if (!source || typeof source !== "object") {
        return { label: "source", text: serialized(source) }
      }
      const value = source as Record<string, unknown>
      return {
        label: "source",
        text: [value.title, value.filename, value.mediaType, value.url]
          .filter(Boolean)
          .join(" · "),
      }
    })
  }
  if (part.type === "action") {
    const status = typeof content.status === "string" ? content.status : ""
    const actionName = typeof content.actionName === "string" ? content.actionName : ""
    const fields = [status, actionName].filter(Boolean)
    if ("input" in content) fields.push(`input=${serialized(content.input)}`)
    if ("output" in content) fields.push(`output=${serialized(content.output)}`)
    if ("error" in content) fields.push(`error=${serialized(content.error)}`)
    return [{ label: "action", text: fields.join(" · ") }]
  }
  return [{ label: part.type, text: serialized(part.content) }]
}

function eventPartLines(
  part: { type: string; content: unknown },
  contentWidth: number,
): readonly TimelineLine[] {
  const labelWidth = 12
  const available = Math.max(1, contentWidth - labelWidth - 3)
  return eventPartContentRows(part).flatMap(row => {
    const content = wrap(row.text, available)
    return (content.length > 0 ? content : [""]).map((text, index) => ({
      text: `  ${index === 0 ? column(row.label, labelWidth) : " ".repeat(labelWidth)} ${text}`,
      color: row.label === "message"
        ? "white" as const
        : row.label === "json"
          ? "yellow" as const
          : "gray" as const,
      dim: row.label !== "message" && row.label !== "json",
    }))
  })
}

function Rail({ active = "", value }: { active?: string; value: string }) {
  return (
    <Text>
      {[...value].map((character, index) => (
        <Text
          key={index}
          color={active[index] && active[index] !== " " ? "cyan" : "gray"}
        >
          {character}
        </Text>
      ))}
    </Text>
  )
}

function continuationRail(value: string): string {
  return value.replaceAll("●", "│")
}

function ReactionTree({
  focused,
  graph,
  maxLines,
  sessionId,
}: {
  focused: boolean
  graph: ReactionGraphState
  maxLines: number
  sessionId?: string
}) {
  const { stdout } = useStdout()
  const [selectedEventId, setSelectedEventId] = useState<string>()
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailOffset, setDetailOffset] = useState(0)
  const timeline = useMemo(
    () => projectSessionTimeline(graph, sessionId),
    [graph, sessionId],
  )
  const navigator = useMemo(() => createReactionNavigator(timeline), [timeline])
  const railWidth = Math.max(1, timeline.lanes * 2 - 1)
  const contentWidth = Math.max(24, Number(stdout.columns ?? 100) - railWidth - 12)
  const selectedIndex = Math.max(0, selectedEventId
    ? timeline.rows.findIndex(row => row.event.id === selectedEventId)
    : timeline.rows.length - 1)
  const selectedRow = timeline.rows[selectedIndex]
  const activeEventIds = useMemo(
    () => selectedEventId
      ? navigator.activeBranch(selectedEventId)
      : new Set(timeline.rows.map(row => row.event.id)),
    [navigator, selectedEventId, timeline.rows],
  )
  const detailLines = useMemo(() => {
    if (!selectedRow) return Object.freeze([]) as readonly TimelineLine[]
    const event = selectedRow.event
    const labelWidth = 12
    const available = Math.max(1, contentWidth - labelWidth - 3)
    const payload: TimelineLine[] = wrap(pretty(event.payload), available).map((text, index) => ({
      text: `  ${index === 0 ? column("payload", labelWidth) : " ".repeat(labelWidth)} ${text}`,
      color: "yellow" as const,
    }))
    return Object.freeze([
      {
        text: `${event.type} #${event.id} · ${event.durability ?? "durable"}`,
        color: "cyan" as const,
        bold: true,
      },
      ...payload,
      ...event.eventParts.flatMap(part => eventPartLines(part, contentWidth)),
    ])
  }, [contentWidth, selectedRow])
  const detailCapacity = Math.max(1, maxLines - 1)
  const maxDetailOffset = Math.max(0, detailLines.length - detailCapacity)

  useEffect(() => {
    setSelectedEventId(undefined)
    setDetailOpen(false)
    setDetailOffset(0)
  }, [sessionId])

  useEffect(() => {
    if (selectedEventId && !timeline.rows.some(row => row.event.id === selectedEventId)) {
      setSelectedEventId(undefined)
      setDetailOpen(false)
    }
  }, [selectedEventId, timeline.rows])

  useEffect(() => {
    setDetailOffset(offset => Math.min(offset, maxDetailOffset))
  }, [maxDetailOffset])

  useInput((_input, key) => {
    if (timeline.rows.length === 0) return
    if (detailOpen) {
      if (key.escape || key.return) {
        setDetailOpen(false)
        setDetailOffset(0)
        return
      }
      if (key.upArrow) setDetailOffset(offset => Math.max(0, offset - 1))
      if (key.downArrow) setDetailOffset(offset => Math.min(maxDetailOffset, offset + 1))
      return
    }
    if (key.upArrow) {
      setSelectedEventId(navigator.move(selectedRow!.event.id, "up"))
    }
    if (key.downArrow) {
      setSelectedEventId(navigator.move(selectedRow!.event.id, "down"))
    }
    if (key.leftArrow) {
      setSelectedEventId(navigator.move(selectedRow!.event.id, "left"))
    }
    if (key.rightArrow) {
      setSelectedEventId(navigator.move(selectedRow!.event.id, "right"))
    }
    if (key.return && selectedRow) {
      setSelectedEventId(selectedRow.event.id)
      setDetailOffset(0)
      setDetailOpen(true)
    }
    if (key.escape) setSelectedEventId(undefined)
  }, { isActive: focused && Boolean(process.stdin.isTTY) })

  const rows = useMemo(() => timeline.rows.map((row, rowIndex) => {
    const summary = timelineEventSummary(row.event)
    const durability = row.event.durability ?? "durable"
    const partCount = row.event.eventParts.length
    const selected = rowIndex === selectedIndex
    const active = activeEventIds.has(row.event.id)
    const navigationNode = navigator.node(row.event.id)
    const branchBadge = navigationNode && navigationNode.fanIn > 1
      ? `fan-in ${navigationNode.fanIn}`
      : navigationNode && navigationNode.fanOut > 1
        ? `fan-out ${navigationNode.fanOut}`
        : ""
    const expanded = selectedEventId
      ? selected
      : durability === "streaming" || rowIndex === timeline.rows.length - 1
    const lines: TimelineLine[] = [{
      text: `${selected && focused ? "› " : "  "}${column(row.event.type, 28)} #${shortId(row.event.id)}  ${durability}${branchBadge ? ` · ${branchBadge}` : ""}${partCount > 0 ? ` · ${partCount} part${partCount === 1 ? "" : "s"}` : ""}${summary ? ` · ${clipped(summary, Math.max(0, contentWidth - 70))}` : ""}`,
      color: selected && focused ? "cyan" : durability === "streaming" ? "cyan" : "blue",
      bold: true,
      dim: !active,
    }]
    if (expanded) {
      lines.push(...row.event.eventParts.flatMap(part => eventPartLines(part, contentWidth)))
    }
    return limitRowLines(
      lines,
      Math.max(1, Math.min(5, maxLines - 2)),
      hiddenLines => ({
        text: `  … ${hiddenLines} more part lines`,
        color: "gray" as const,
        dim: true,
      }),
    )
  }), [activeEventIds, contentWidth, focused, maxLines, navigator, selectedEventId, selectedIndex, timeline.rows])
  const rowHeights = useMemo(() => rows.map(lines => lines.length), [rows])
  const rail = useMemo(
    () => buildTimelineRail(timeline, rowHeights, activeEventIds),
    [activeEventIds, rowHeights, timeline],
  )
  const viewport = useMemo(() => {
    if (selectedEventId) {
      const centered = selectCenteredTerminalViewport(rows, selectedIndex, maxLines)
      return {
        hiddenBefore: centered.hiddenBefore,
        hiddenAfter: centered.hiddenAfter,
        rows: centered.rows,
      }
    }
    const tail = selectTerminalViewport(rows, maxLines)
    return { hiddenBefore: tail.hiddenRows, hiddenAfter: 0, rows: tail.rows }
  }, [maxLines, rows, selectedEventId, selectedIndex])
  const rowStarts = useMemo(() => {
    const starts: number[] = []
    let offset = 0
    for (const height of rowHeights) {
      starts.push(offset)
      offset += height
    }
    return starts
  }, [rowHeights])

  if (timeline.rows.length === 0) {
    return <Text dimColor>Waiting for the reaction graph…</Text>
  }
  if (detailOpen) {
    const visible = detailLines.slice(detailOffset, detailOffset + detailCapacity)
    return (
      <Box flexDirection="column">
        {visible.map((line, index) => (
          <Text
            key={`${selectedRow?.event.id ?? "event"}:detail:${detailOffset + index}`}
            bold={line.bold}
            color={line.color}
            dimColor={line.dim}
            wrap="truncate-end"
          >
            {line.text}
          </Text>
        ))}
        <Text dimColor>
          {detailOffset + 1}-{Math.min(detailLines.length, detailOffset + detailCapacity)}/{detailLines.length}
          {maxDetailOffset > 0 ? " · ↑↓ scroll" : ""} · Enter/Esc tree
        </Text>
      </Box>
    )
  }
  const firstVisibleIndex = viewport.rows[0]?.rowIndex ?? 0
  const lastVisibleIndex = viewport.rows.at(-1)?.rowIndex ?? firstVisibleIndex
  const topBoundaryLine = rowStarts[firstVisibleIndex] ?? 0
  const bottomBoundaryLine = (rowStarts[lastVisibleIndex] ?? 0)
    + (rowHeights[lastVisibleIndex] ?? 1) - 1
  return (
    <Box flexDirection="column">
      {viewport.hiddenBefore > 0 ? (
        <Box width="100%">
          <Box flexGrow={1} minWidth={0}>
            <Text dimColor>  ↑ {viewport.hiddenBefore} earlier Events</Text>
          </Box>
          <Text>  </Text>
          <Box width={rail.width} flexShrink={0}>
            <Rail
              active={continuationRail(rail.activeLines[topBoundaryLine] ?? "")}
              value={continuationRail(rail.lines[topBoundaryLine] ?? " ".repeat(rail.width))}
            />
          </Box>
        </Box>
      ) : null}
      {viewport.rows.flatMap(({ lines, rowIndex }) => lines.map((line, lineIndex) => {
        const railLine = rail.lines[(rowStarts[rowIndex] ?? 0) + lineIndex]
          ?? " ".repeat(rail.width)
        const activeRailLine = rail.activeLines[(rowStarts[rowIndex] ?? 0) + lineIndex]
          ?? " ".repeat(rail.width)
        return (
          <Box key={`${timeline.rows[rowIndex]!.event.id}:${lineIndex}`} width="100%">
            <Box flexGrow={1} minWidth={0}>
              <Text
                bold={line.bold}
                color={line.color}
                dimColor={line.dim}
                wrap="truncate-end"
              >
                {line.text}
              </Text>
            </Box>
            <Text>  </Text>
            <Box width={rail.width} flexShrink={0}>
              <Rail active={activeRailLine} value={railLine} />
            </Box>
          </Box>
        )
      }))}
      {viewport.hiddenAfter > 0 ? (
        <Box width="100%">
          <Box flexGrow={1} minWidth={0}>
            <Text dimColor>  ↓ {viewport.hiddenAfter} later Events</Text>
          </Box>
          <Text>  </Text>
          <Box width={rail.width} flexShrink={0}>
            <Rail
              active={continuationRail(rail.activeLines[bottomBoundaryLine] ?? "")}
              value={continuationRail(rail.lines[bottomBoundaryLine] ?? " ".repeat(rail.width))}
            />
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}

function LiveOutput({
  contentWidth,
  output,
  phase,
}: {
  contentWidth: number
  output?: RunOutput
  phase: Phase
}) {
  if (output) {
    return (
      <Box flexDirection="column">
        <Text bold color="green">{output.event.type}</Text>
        <Text>{limitedPretty(output.event.payload, contentWidth, 3)}</Text>
        <Text dimColor>
          event #{shortId(output.event.id)} · {output.event.eventParts.length} parts · {output.elapsedMs}ms
        </Text>
      </Box>
    )
  }

  return <Text dimColor>{phase === "running" ? "Awaiting the final Event…" : "No output yet."}</Text>
}

export function ReactionInspector({ options }: { options: CliOptions }) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const interactive = options.input === undefined
  const [app, setApp] = useState<ReactionChatInstantApp>()
  const [phase, setPhase] = useState<Phase>("provisioning")
  const [contextKey, setContextKey] = useState(options.contextKey)
  const [inputText, setInputText] = useState("")
  const [currentInput, setCurrentInput] = useState<unknown>(options.input)
  const [graph, setGraph] = useState(emptyReactionGraph)
  const [contextId, setContextId] = useState<string>()
  const [sessionId, setSessionId] = useState<string>()
  const [output, setOutput] = useState<RunOutput>()
  const [error, setError] = useState<string>()
  const [startedAt, setStartedAt] = useState<number>()
  const [clock, setClock] = useState(Date.now())
  const [focus, setFocus] = useState<"input" | "reaction">(
    interactive ? "input" : "reaction",
  )
  const autoStarted = useRef(false)

  useInput((_input, key) => {
    if (!interactive || phase === "running" || !key.tab) return
    setFocus(current => current === "input" ? "reaction" : "input")
  }, { isActive: Boolean(app) && interactive && Boolean(process.stdin.isTTY) })

  useEffect(() => {
    let active = true
    void createReactionChatInstantApp()
      .then(created => {
        if (!active) return
        process.env.REACTION_CHAT_INSTANT_APP_ID = created.appId
        process.env.REACTION_CHAT_INSTANT_ADMIN_TOKEN = created.adminToken
        setApp(created)
        setPhase("ready")
      })
      .catch(reason => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setPhase("failed")
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (phase !== "running") return
    const timer = setInterval(() => setClock(Date.now()), 250)
    return () => clearInterval(timer)
  }, [phase])

  const run = useCallback(async (input: unknown, autoExit = false) => {
    if (!app || phase === "running") return
    setCurrentInput(input)
    setGraph(emptyReactionGraph())
    setContextId(undefined)
    setSessionId(undefined)
    setOutput(undefined)
    setError(undefined)
    setStartedAt(Date.now())
    setClock(Date.now())
    setFocus("reaction")
    setPhase("running")

    try {
      const started = await startReactionTurn({
        modulePath: options.modulePath,
        contextKey,
        input,
      })
      setContextId(started.run.contextId)
      setSessionId(started.run.sessionId)
      const db = createSessionLogDb(app)
      const logging = logSession({
        db,
        sessionId: started.run.sessionId,
        write(record) {
          setGraph(previous => reduceSessionLog(previous, record))
        },
      })
      const [result] = await Promise.all([completeReactionTurn(started), logging])
      setOutput(result)
      setPhase("completed")
      if (autoExit) setTimeout(exit, 100)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setPhase("failed")
      if (autoExit) setTimeout(exit, 100)
    }
  }, [app, contextKey, exit, options.modulePath, phase])

  useEffect(() => {
    if (!app || options.input === undefined || autoStarted.current) return
    autoStarted.current = true
    void run(options.input, true)
  }, [app, options.input, run])

  const submit = useCallback((value: string) => {
    const trimmed = value.trim()
    if (!trimmed || phase === "running") return
    if (trimmed === "/exit") {
      exit()
      return
    }
    if (trimmed === "/new" || trimmed.startsWith("/new ")) {
      setContextKey(trimmed.slice(4).trim() || `reaction:${randomUUID()}`)
      setInputText("")
      setCurrentInput(undefined)
      setGraph(emptyReactionGraph())
      setContextId(undefined)
      setSessionId(undefined)
      setOutput(undefined)
      setError(undefined)
      setFocus("input")
      setPhase("ready")
      return
    }
    if (trimmed.startsWith("/context ")) {
      const nextContextKey = trimmed.slice("/context ".length).trim()
      if (!nextContextKey) {
        setError("Context key is required.")
        return
      }
      setContextKey(nextContextKey)
      setInputText("")
      setCurrentInput(undefined)
      setGraph(emptyReactionGraph())
      setContextId(undefined)
      setSessionId(undefined)
      setOutput(undefined)
      setError(undefined)
      setFocus("input")
      setPhase("ready")
      return
    }
    try {
      const parsed = JSON.parse(trimmed)
      setInputText("")
      void run(parsed)
    } catch {
      setError("Input must be valid JSON.")
    }
  }, [exit, phase, run])

  const elapsedMs = startedAt ? clock - startedAt : 0
  const session = sessionId ? graph.entities.context_sessions[sessionId] : undefined
  const sessionStatus = session?.status ?? (phase === "running" ? "running" : phase)
  const terminalRows = Math.max(20, Number(stdout.rows ?? 30))
  const terminalColumns = Math.max(50, Number(stdout.columns ?? 100))
  const reactionMaxLines = Math.max(3, terminalRows - (interactive ? 24 : 22))
  const panelContentWidth = Math.max(24, terminalColumns - 8)

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">EKAIROS · REACTION</Text>
        <Status value={sessionStatus} />
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>
          app      {app ? `${app.title} · ${app.appId}` : "creating a fresh Instant app…"}
        </Text>
        <Text dimColor>context  {contextKey}{contextId ? ` · ${contextId}` : ""}</Text>
        <Text dimColor>session  {sessionId ?? "pending"}{phase === "running" ? ` · ${elapsedMs}ms` : ""}</Text>
      </Box>

      <Box borderStyle="round" borderColor="blue" flexDirection="column" paddingX={1} marginBottom={1}>
        <Text bold color="blue">INPUT</Text>
        {currentInput === undefined
          ? <Text dimColor>Enter a JSON value below.</Text>
          : <Text>{limitedPretty(currentInput, panelContentWidth, 1)}</Text>}
      </Box>

      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} marginBottom={1}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">REACTION</Text>
          <Status value={sessionStatus} />
        </Box>
        <ReactionTree
          focused={interactive && focus === "reaction"}
          graph={graph}
          maxLines={reactionMaxLines}
          sessionId={sessionId}
        />
      </Box>

      <Box borderStyle="round" borderColor={phase === "failed" ? "red" : "green"} flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color={phase === "failed" ? "red" : "green"}>OUTPUT</Text>
          {phase === "running" ? <Text color="yellow">streaming</Text> : null}
        </Box>
        <LiveOutput
          contentWidth={panelContentWidth}
          output={output}
          phase={phase}
        />
        {error ? <Text color="red">{error}</Text> : null}
      </Box>

      {interactive ? (
        <Box marginTop={1}>
          <Text color={focus === "input" ? "cyan" : "gray"}>input › </Text>
          <TextInput
            value={inputText}
            onChange={setInputText}
            onSubmit={submit}
            placeholder='{"text":"..."}'
            focus={Boolean(app) && phase !== "running" && focus === "input"}
          />
        </Box>
      ) : null}
      {interactive ? (
        <Text dimColor>
          Tab input/reaction · ↑↓ causal · ←→ branch · Enter details · Esc tree · /new · /context · /exit
        </Text>
      ) : null}
    </Box>
  )
}

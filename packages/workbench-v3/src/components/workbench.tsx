"use client"

import {
  useContext as useEkairosContext,
  type ContextEventForUI,
  type ContextEventPartForUI,
  type ContextReactionForUI,
  type ContextSessionForUI,
} from "@ekairos/events/react"
import { init } from "@instantdb/react"
import {
  Activity,
  ArrowUp,
  Bot,
  Boxes,
  Braces,
  ChartGantt,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  GitFork,
  LoaderCircle,
  MessageSquare,
  Network,
  Paperclip,
  Radio,
  TerminalSquare,
  User,
  X,
} from "lucide-react"
import { CSSProperties, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { Streamdown } from "streamdown"

import { workbenchClientSchema } from "@/src/client-schema"
import { buildReactionGantt } from "@/src/reaction-gantt"
import {
  buildEventTimeline,
  reactionDurationMs,
  reactionTitle,
} from "@/src/reaction-graph"

type Bootstrap = Readonly<{
  appId: string
  contextId: string
  contextKey: string
  model: string
  sandbox: string
}>

type Scenario = "chat" | "review"

const REVIEW_SAMPLE = [
  "Revisar esta solicitud de compra:",
  "- 12 notebooks empresariales de 14 pulgadas",
  "- 24 monitores de 27 pulgadas",
  "- 12 docking stations USB-C",
  "Presupuesto máximo: USD 45.000.",
  "Entrega requerida: 30 días.",
  "Determina los ítems formales, restricciones, riesgos y la recomendación concreta.",
].join("\n")

function short(value: string | null | undefined, size = 8) {
  return value ? value.slice(0, size) : "-"
}

function time(value: string | Date | undefined) {
  if (!value) return "-"
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

function clock(value: string | Date | undefined) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value))
}

function durationText(value: number) {
  if (value < 1_000) return `${Math.round(value)}ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`
  return `${(value / 60_000).toFixed(1)}m`
}

// Elegant JSON tree: colored primitives, raw (unescaped) strings, long text
// collapsed behind its first line.
export function JsonView({ value }: { value: unknown }) {
  return <div className="json-view">{renderJsonNode(value)}</div>
}

function renderJsonNode(value: unknown): ReactNode {
  if (value === null || value === undefined) return <span className="jv-null">null</span>
  if (typeof value === "string") {
    if (!value) return <span className="jv-null">""</span>
    if (value.length > 140 || value.includes("\n")) {
      return (
        <details className="jv-long">
          <summary>{clip(value, 96)}</summary>
          <pre>{value}</pre>
        </details>
      )
    }
    return <span className="jv-string">{value}</span>
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return <span className="jv-number">{String(value)}</span>
  }
  if (typeof value === "boolean") return <span className="jv-boolean">{String(value)}</span>
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="jv-null">[]</span>
    return (
      <div className="jv-block">
        {value.map((item, index) => (
          <div className="jv-row" key={index}>
            <span className="jv-key">{index}</span>
            {renderJsonNode(item)}
          </div>
        ))}
      </div>
    )
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span className="jv-null">{"{}"}</span>
    return (
      <div className="jv-block">
        {entries.map(([key, item]) => (
          <div className="jv-row" key={key}>
            <span className="jv-key">{key}</span>
            {renderJsonNode(item)}
          </div>
        ))}
      </div>
    )
  }
  return <span className="jv-string">{String(value)}</span>
}

function partText(part: ContextEventPartForUI) {
  const content = part.content as any
  if (typeof content?.text === "string") return content.text
  if (Array.isArray(content?.blocks)) {
    return content.blocks
      .filter((block: any) => block?.type === "text")
      .map((block: any) => block.text)
      .join("\n")
  }
  return ""
}

function eventText(event: ContextEventForUI) {
  const messages = event.eventParts.filter(part => part.type === "message")
    .map(partText).filter(Boolean)
  if (messages.length) return messages.join("\n\n")
  if (typeof event.payload === "string") return event.payload
  const payload = event.payload as any
  return typeof payload?.text === "string" ? payload.text : ""
}

function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot status-${status}`} aria-label={status} />
}

function PartView({ part }: { part: ContextEventPartForUI }) {
  if (part.type === "message") {
    return (
      <div className="markdown">
        <Streamdown>{partText(part)}</Streamdown>
      </div>
    )
  }
  if (part.type === "reasoning") {
    return (
      <details className="part-detail reasoning-part" open>
        <summary>Reasoning - {(part.content as any)?.state ?? "done"}</summary>
        <pre>{(part.content as any)?.text ?? ""}</pre>
      </details>
    )
  }
  if (part.type === "action") {
    const content = part.content as any
    return (
      <details className="part-detail action-part" open>
        <summary>{content.actionName} - {content.status}</summary>
        <JsonView value={content.input ?? content.output ?? content.error} />
      </details>
    )
  }
  return <div className="part-detail"><JsonView value={part.content} /></div>
}

function Message({ event }: { event: ContextEventForUI }) {
  const user = event.type === "workbench.messageReceived" || event.type === "user.message"
  const text = eventText(event)
  const files = linkedFileCount(event)
  if (!text && event.eventParts.length === 0) return null
  return (
    <article className={`message ${user ? "message-user" : "message-assistant"}`}>
      <header>
        <span className="message-author">{user ? <User size={14} /> : <Bot size={14} />}</span>
        <strong>{user ? "You" : "Reaction"}</strong>
        <span>{time(event.createdAt)}</span>
        {files > 0 ? <span className="message-files"><Paperclip size={11} />{files}</span> : null}
        <span className={`durability durability-${event.durability ?? "durable"}`}>
          {event.durability ?? "durable"}
        </span>
      </header>
      {event.eventParts.length > 0
        ? event.eventParts.map(part => <PartView key={part.id} part={part} />)
        : <div className="markdown"><Streamdown>{text}</Streamdown></div>}
    </article>
  )
}

function allSessionReactions(session: ContextSessionForUI): ContextReactionForUI[] {
  const rows = [
    ...session.reactions,
    ...session.children.flatMap(allSessionReactions),
  ]
  return [...new Map(rows.map(reaction => [reaction.id, reaction])).values()]
}

function sessionResponse(session: ContextSessionForUI) {
  const durable = session.rootReaction?.effects.at(-1)
  if (durable) return durable
  return allSessionReactions(session)
    .flatMap(reaction => [...reaction.effects, ...reaction.liveEffects])
    .filter(event => event.type === "context.model")
    .sort((left, right) => new Date(left.createdAt).valueOf() - new Date(right.createdAt).valueOf())
    .at(-1) ?? null
}

function ConversationCausalGraph({
  session,
  selectedId,
  onSelect,
}: {
  session: ContextSessionForUI
  selectedId: string | null
  onSelect(id: string): void
}) {
  const omit = useMemo(() => {
    const response = sessionResponse(session)
    return new Set([session.trigger?.id, response?.id]
      .filter((id): id is string => Boolean(id)))
  }, [session])
  const [open, setOpen] = useState(session.status === "running")
  const reactionCount = Math.max(0, allSessionReactions(session).length - 1)
  const finish = sessionResponse(session)?.createdAt
  const elapsed = session.trigger && finish
    ? Math.max(0, new Date(finish).valueOf() - new Date(session.trigger.createdAt).valueOf())
    : null
  return (
    <section className={`conversation-causal ${open ? "open" : ""}`} aria-label="Causal timeline">
      <button className="conversation-causal-toggle" onClick={() => setOpen(value => !value)} type="button">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <GitFork size={11} />
        <span>Causal timeline</span>
        <code>
          {reactionCount} Reactions
          {elapsed === null ? "" : ` · ${(elapsed / 1000).toFixed(1)}s`}
        </code>
        <StatusDot status={session.status} />
      </button>
      {open ? (
        <EventTimelineView
          omit={omit}
          onSelect={onSelect}
          selectedId={selectedId}
          session={session}
          variant="chat"
        />
      ) : null}
    </section>
  )
}

function ConversationTurn({
  session,
  selectedId,
  onSelect,
}: {
  session: ContextSessionForUI
  selectedId: string | null
  onSelect(id: string): void
}) {
  const response = sessionResponse(session)
  return (
    <div className="conversation-turn">
      {session.trigger ? <Message event={session.trigger} /> : null}
      <ConversationCausalGraph
        session={session}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <article className="message message-assistant reaction-message">
        <header>
          <span className="message-author"><Bot size={14} /></span>
          <strong>Reaction</strong>
          <span>{time(response?.createdAt ?? session.createdAt)}</span>
          <StatusDot status={session.status} />
          <span>{session.status}</span>
        </header>
        {response ? (
          response.eventParts.length > 0
            ? response.eventParts.map(part => <PartView key={part.id} part={part} />)
            : <div className="markdown"><Streamdown>{eventText(response)}</Streamdown></div>
        ) : (
          <div className="reaction-pending"><LoaderCircle className="spin" size={14} />Building effects...</div>
        )}
      </article>
    </div>
  )
}

export function EventTimelineView({
  session,
  selectedId,
  onSelect,
  variant = "inspector",
  omit,
}: {
  session: ContextSessionForUI
  selectedId: string | null
  onSelect(id: string): void
  variant?: "inspector" | "chat"
  omit?: ReadonlySet<string>
}) {
  const timeline = useMemo(() => buildEventTimeline(session), [session])
  const rows = useMemo(
    () => omit ? timeline.rows.filter(row => !omit.has(row.event.id)) : timeline.rows,
    [timeline, omit],
  )
  const selected = useMemo(
    () => allSessionReactions(session).find(reaction => reaction.id === selectedId) ?? null,
    [session, selectedId],
  )
  const causeIds = useMemo(() => new Set(selected?.causeIds ?? []), [selected])
  const reactionCount = new Set(rows.map(row => row.producer?.id).filter(Boolean)).size
  const firstProducerRow = useMemo(() => {
    const first = new Map<string, number>()
    rows.forEach((row, index) => {
      const id = row.producer?.id
      if (id && !first.has(id)) first.set(id, index)
    })
    return first
  }, [rows])
  const chat = variant === "chat"
  const positions = useMemo(() => new Map(
    rows.map((row, index) => [row.event.id, { index, lane: row.lane, branch: row.branch }]),
  ), [rows])
  const railWidth = TIMELINE_RAIL_BASE + timeline.lanes * TIMELINE_LANE_WIDTH + 4
  const orderedEdges = [
    ...timeline.edges.filter(edge => edge.reactionId !== selectedId),
    ...timeline.edges.filter(edge => edge.reactionId === selectedId),
  ]
  return (
    <section className={`event-timeline ${variant}`}>
      {chat ? null : (
        <header className="timeline-toolbar">
          <strong>{session.definition}</strong>
          <span>{rows.length} Events / {reactionCount} Reactions</span>
        </header>
      )}
      <div className="timeline" style={{ "--rail-w": `${railWidth}px` } as CSSProperties}>
        <svg
          aria-hidden="true"
          className="timeline-edges"
          height={rows.length * TIMELINE_ROW_HEIGHT}
          width={railWidth}
        >
          {orderedEdges.map(edge => {
            const from = positions.get(edge.from)
            const to = positions.get(edge.to)
            if (!from || !to) return null
            const active = edge.reactionId === selectedId
            return (
              <path
                className={[edge.kind, active ? "selected" : ""].filter(Boolean).join(" ")}
                d={timelineEdgePath(from, to, railWidth)}
                key={edge.id}
                stroke={active ? "var(--cyan)" : branchColor(Math.max(from.branch, to.branch))}
              />
            )
          })}
        </svg>
        {rows.map((row, index) => {
          const producer = row.producer
          const duration = producer ? reactionDurationMs(producer) : null
          const repeatedProducer =
            producer !== null && firstProducerRow.get(producer.id) !== index
          const summary = eventSummary(row.event)
          const classNames = [
            "timeline-row",
            producer && producer.id === selectedId ? "selected" : "",
            causeIds.has(row.event.id) ? "cause" : "",
            row.child ? "child" : "",
            `durability-${row.event.durability ?? "durable"}`,
            producer?.status === "failed" ? "failed" : "",
            producer?.status === "running" ? "running" : "",
          ].filter(Boolean).join(" ")
          return (
            <button
              className={classNames}
              key={row.event.id}
              onClick={() => producer && onSelect(producer.id)}
              title={producer ? reactionTitle(producer) : row.event.id}
              type="button"
            >
              <span
                className="timeline-rail"
                style={{
                  "--dot-r": `${TIMELINE_RAIL_BASE + row.lane * TIMELINE_LANE_WIDTH}px`,
                  "--dot": branchColor(row.branch),
                } as CSSProperties}
              >
                <span className="timeline-dot" />
              </span>
              {chat ? (
                summary
                  ? <span className="timeline-summary">{summary}</span>
                  : <span className="timeline-type">{row.event.type}</span>
              ) : (
                <>
                  <span className="timeline-type">{row.event.type}</span>
                  <span className="timeline-summary">{summary}</span>
                </>
              )}
              {row.branchOf ? (
                <span className="timeline-badge" title={row.branchOf}>
                  {compactName(row.branchOf)}
                </span>
              ) : null}
              <span className="timeline-reaction">
                {producer
                  ? repeatedProducer
                    ? "·"
                    : `${producer.type.split(":")[0]}${duration === null ? "" : ` ${(duration / 1000).toFixed(1)}s`}`
                  : "trigger"}
              </span>
              {chat ? null : <time>{clock(row.event.createdAt)}</time>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

const TIMELINE_ROW_HEIGHT = 27
const TIMELINE_LANE_WIDTH = 12
const TIMELINE_RAIL_BASE = 15
const TIMELINE_BRANCH_COLORS = ["#5c6a70", "#75aadb", "#d4af37", "#65d688", "#cfc3f5", "#ff5c67"]

// "dataset.file.materialize:d0d6ca81-..." -> "materialize"
function compactName(value: string) {
  const base = value.split(":")[0] ?? value
  return base.split(".").pop() || base
}

function branchColor(branch: number) {
  return TIMELINE_BRANCH_COLORS[branch % TIMELINE_BRANCH_COLORS.length]!
}

// The graph hangs on the right edge, so lane 0 hugs the right border and
// deeper lanes grow leftward into the label area.
function timelineEdgePath(
  from: { index: number; lane: number },
  to: { index: number; lane: number },
  railWidth: number,
) {
  const x1 = railWidth - TIMELINE_RAIL_BASE - from.lane * TIMELINE_LANE_WIDTH
  const x2 = railWidth - TIMELINE_RAIL_BASE - to.lane * TIMELINE_LANE_WIDTH
  const y1 = from.index * TIMELINE_ROW_HEIGHT + TIMELINE_ROW_HEIGHT / 2
  const y2 = to.index * TIMELINE_ROW_HEIGHT + TIMELINE_ROW_HEIGHT / 2
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  // Ride the source lane, then curve into the target lane over the last row,
  // the way git GUIs draw branch and merge edges.
  const bend = Math.max(y1, y2 - TIMELINE_ROW_HEIGHT)
  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${bend}`,
    `C ${x1} ${bend + TIMELINE_ROW_HEIGHT * 0.65}, ${x2} ${y2 - TIMELINE_ROW_HEIGHT * 0.65}, ${x2} ${y2}`,
  ].join(" ")
}

function linkedFileCount(event: ContextEventForUI) {
  const value = event.links.files
  if (Array.isArray(value)) return value.length
  return typeof value === "string" && value ? 1 : 0
}

function clip(value: string, size = 62) {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > size ? `${text.slice(0, size - 3)}...` : text
}

// One preview per Event row: prefer human text, then the concrete artifact
// the Event is about (action, command, files, records, repository...).
function eventSummary(event: ContextEventForUI) {
  const payload = event.payload as any
  const direct = typeof payload === "string"
    ? payload
    : typeof payload?.text === "string"
      ? payload.text
      : typeof payload?.summary === "string"
        ? payload.summary
        : eventText(event)
  if (direct) return clip(direct)

  const action = event.eventParts.find(part => part.type === "action")
  if (action) {
    const content = action.content as any
    const name = typeof content?.actionName === "string" ? content.actionName : ""
    const status = typeof content?.status === "string" ? content.status : ""
    if (name) return clip(status ? `${name} · ${status}` : name)
  }

  if (payload && typeof payload === "object") {
    if (typeof payload.command === "string") return clip(`$ ${payload.command}`)
    if (typeof payload.message === "string") return clip(payload.message)
    if (Array.isArray(payload.files) && payload.files.length > 0) {
      const names = payload.files
        .map((file: any) => file?.name ?? file?.filename ?? file?.path)
        .filter((name: unknown): name is string => typeof name === "string" && name.length > 0)
      const label = names.slice(0, 3).join(", ")
      const count = `${payload.files.length} file${payload.files.length === 1 ? "" : "s"}`
      return clip(label ? `${count} · ${label}` : count)
    }
    for (const key of ["records", "rows", "items"] as const) {
      if (Array.isArray(payload[key])) return `${payload[key].length} ${key}`
    }
    for (const key of ["repository", "url", "path", "branch", "name", "datasetId", "error"] as const) {
      if (typeof payload[key] === "string" && payload[key]) return clip(payload[key])
    }
  }

  const reasoning = event.eventParts.find(part => part.type === "reasoning")
  const thought = (reasoning?.content as any)?.text
  if (typeof thought === "string" && thought) return clip(thought)
  return ""
}

function ReactionGanttView({
  session,
  selectedId,
  onSelect,
}: {
  session: ContextSessionForUI
  selectedId: string | null
  onSelect(id: string): void
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (session.status !== "running") return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [session.status])
  const gantt = useMemo(() => buildReactionGantt(session, now), [now, session])

  return (
    <section className="reaction-gantt" aria-label="Reaction workflow Gantt">
      <header className="gantt-summary">
        <div>
          <strong>{session.definition}</strong>
          <code>{session.workflowRunId ? short(session.workflowRunId, 18) : "direct"}</code>
        </div>
        <span>{gantt.rows.length - 1} steps / {durationText(gantt.durationMs)}</span>
      </header>
      <div className="gantt-ruler" aria-hidden="true">
        {[0, 25, 50, 75, 100].map(value => (
          <span key={value} style={{ left: `${value}%` }}>{value}%</span>
        ))}
      </div>
      <div className="gantt-rows">
        {gantt.rows.map(row => {
          const selected = row.reaction?.id === selectedId
          const content = (
            <>
              <span
                className="gantt-label"
                style={{ paddingLeft: 10 + Math.min(row.depth, 4) * 10 }}
                title={row.label}
              >
                {row.kind === "workflow" ? <ChartGantt size={11} /> : <StatusDot status={row.status} />}
                <strong>{row.label}</strong>
              </span>
              <span className="gantt-track">
                <span className="gantt-gridline quarter-1" />
                <span className="gantt-gridline quarter-2" />
                <span className="gantt-gridline quarter-3" />
                <span
                  className={`gantt-bar gantt-${row.kind} status-${row.status}`}
                  style={{ left: `${row.offsetPercent}%`, width: `${row.widthPercent}%` }}
                  title={`${row.label}: ${durationText(row.durationMs)}`}
                />
              </span>
              <time>{durationText(row.durationMs)}</time>
            </>
          )
          return row.reaction ? (
            <button
              className={`gantt-row ${selected ? "selected" : ""}`}
              key={row.id}
              onClick={() => onSelect(row.id)}
              type="button"
            >
              {content}
            </button>
          ) : (
            <div className="gantt-row workflow" key={row.id}>{content}</div>
          )
        })}
      </div>
      <footer className="gantt-foot">
        <span>{clock(new Date(gantt.startMs))}</span>
        <span>{clock(new Date(gantt.endMs))}</span>
      </footer>
    </section>
  )
}

function ChunkTrace({ reaction }: { reaction: ContextReactionForUI | null }) {
  if (!reaction) return <div className="empty"><GitFork size={20} />Select a Reaction.</div>
  const stream = reaction.stream
  return (
    <section className="trace-detail">
      <div className="trace-heading">
        <div>
          <span className="eyebrow">Reaction {short(reaction.id, 12)}</span>
          <h2>{reaction.type}</h2>
        </div>
        <span className="status-label"><StatusDot status={reaction.status} />{reaction.status}</span>
      </div>
      <dl className="trace-metadata">
        <div><dt>causes</dt><dd>{reaction.causeIds.map(id => short(id)).join(", ") || "-"}</dd></div>
        <div><dt>effects</dt><dd>{reaction.effectIds.map(id => short(id)).join(", ") || "pending"}</dd></div>
        <div><dt>stream</dt><dd>{stream ? short(stream.id, 12) : "none"}</dd></div>
        <div><dt>reader</dt><dd>{stream?.reader.status ?? "not streaming"}</dd></div>
        <div><dt>offset</dt><dd>{stream?.reader.byteOffset ?? 0} B</dd></div>
        <div><dt>depth</dt><dd>{reaction.depth}</dd></div>
      </dl>
      {reaction.instruction ? <p className="instruction">{reaction.instruction}</p> : null}
      {!stream ? (
        <div className="empty compact">This Reaction has no provisional stream.</div>
      ) : (
        <div className="chunks">
          {stream.chunks.map(chunk => <ChunkRow chunk={chunk} key={chunk.sequence} />)}
          {stream.chunks.length === 0 ? (
            <div className="empty compact"><Radio size={16} />Waiting for the first chunk.</div>
          ) : null}
        </div>
      )}
    </section>
  )
}

type TraceChunk = NonNullable<ContextReactionForUI["stream"]>["chunks"][number]

function ChunkRow({ chunk }: { chunk: TraceChunk }) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className={`chunk chunk-${chunk.kind.replaceAll(".", "-")}`}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="chunk-sequence">{chunk.sequence}</span>
        <strong>{chunk.kind}</strong>
        <span>{chunk.providerType ?? chunk.provider ?? "reactor"}</span>
        <time>{time(chunk.at)}</time>
      </summary>
      {open ? (
        <>
          {chunk.delta ? <pre className="chunk-delta">{chunk.delta}</pre> : null}
          {chunk.actionName ? (
            <div className="chunk-action">{chunk.actionName} - {short(chunk.actionCallId, 12)}</div>
          ) : null}
          {chunk.input !== undefined ? <JsonView value={chunk.input} /> : null}
          {chunk.output !== undefined ? <JsonView value={chunk.output} /> : null}
          {chunk.error !== undefined ? <JsonView value={chunk.error} /> : null}
          {chunk.data !== undefined ? <JsonView value={chunk.data} /> : null}
          {chunk.raw !== undefined ? (
            <details className="provider-raw">
              <summary>provider raw</summary>
              <JsonView value={chunk.raw} />
            </details>
          ) : null}
        </>
      ) : null}
    </details>
  )
}

function LiveWorkbench({ bootstrap }: { bootstrap: Bootstrap }) {
  const db = useMemo(() => init({
    appId: bootstrap.appId,
    schema: workbenchClientSchema,
    useDateObjects: true,
  } as any), [bootstrap.appId])
  const [scenario, setScenario] = useState<Scenario>("review")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [traceView, setTraceView] = useState<"gantt" | "graph">("gantt")
  const streamReactionIds = useMemo(() => selectedId ? [selectedId] : [], [selectedId])
  const context = useEkairosContext(db, {
    apiUrl: "/api/context",
    contextKey: bootstrap.contextKey,
    initialContextId: bootstrap.contextId,
    prepareRequestBody: body => ({ ...body, scenario }),
    streamReactionIds,
  })
  const [draft, setDraft] = useState(REVIEW_SAMPLE)
  const [attachment, setAttachment] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const conversationSessions = useMemo(() => context.sessions
    .filter(session => !session.parentSessionId)
    .sort((left, right) =>
      new Date(left.createdAt).valueOf() - new Date(right.createdAt).valueOf()),
  [context.sessions])
  const sessionTriggerIds = useMemo(
    () => new Set(conversationSessions.flatMap(session => session.trigger?.id ?? [])),
    [conversationSessions],
  )
  const pendingMessages = useMemo(() => context.events.filter(event =>
    (event.type === "workbench.messageReceived" || event.type === "user.message") &&
    !sessionTriggerIds.has(event.id)), [context.events, sessionTriggerIds])
  const rootIds = useMemo(() => new Set(context.sessions
    .filter(session => !session.parentSessionId)
    .map(session => session.rootReaction?.id ?? "")), [context.sessions])
  const graphReactions = useMemo(() => [
    ...new Map(context.sessions
      .flatMap(allSessionReactions)
      .map(reaction => [reaction.id, reaction])).values(),
  ], [context.sessions])
  const operationReactions = useMemo(
    () => graphReactions.filter(reaction => !rootIds.has(reaction.id)),
    [graphReactions, rootIds],
  )
  const selected = operationReactions.find(reaction => reaction.id === selectedId)
    ?? operationReactions.find(reaction => reaction.status === "running")
    ?? [...operationReactions].reverse().find(reaction => reaction.stream)
    ?? operationReactions[0]
    ?? null
  const activeSession = context.context?.currentSession ?? context.sessions[0] ?? null

  useEffect(() => {
    if (selectedId) return
    const runningStream = operationReactions.find(reaction =>
      reaction.status === "running" && reaction.stream)
    if (runningStream) {
      setSelectedId(runningStream.id)
      return
    }
    if (selected) setSelectedId(selected.id)
  }, [operationReactions, selected, selectedId])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }) }, [conversationSessions, pendingMessages])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = draft.trim()
    if (!value || context.sendStatus !== "idle") return
    const parts: any[] = [{ type: "text", text: value }]
    if (attachment) {
      parts.push({
        type: "file",
        filename: attachment.name,
        mediaType: attachment.type || "application/octet-stream",
        url: await fileDataURL(attachment),
      })
    }
    setDraft("")
    setAttachment(null)
    setSelectedId(null)
    await context.append({ parts }).catch(() => undefined)
  }

  return (
    <main className="workbench-shell">
      <header className="topbar">
        <div className="brand-mark">E<span>K</span></div>
        <div className="brand-copy"><strong>Workbench v3</strong><span>Reaction stream inspector</span></div>
        <div className="topbar-spacer" />
        <span className="topbar-chip"><Database size={13} />{short(bootstrap.appId, 12)}</span>
        <span className="topbar-chip"><Bot size={13} />{bootstrap.model}</span>
        <span className="topbar-chip"><Boxes size={13} />{bootstrap.sandbox}</span>
        <span className="topbar-chip"><StatusDot status={context.contextStatus} />{context.contextStatus}</span>
      </header>

      <div className="workspace-grid">
        <aside className="navigator panel">
          <div className="panel-title"><span>Context</span><Braces size={15} /></div>
          <div className="context-identity">
            <strong>{context.context?.name ?? bootstrap.contextKey}</strong>
            <code>{context.contextId}</code>
          </div>
          <div className="metric-grid">
            <div><strong>{context.sessions.length}</strong><span>sessions</span></div>
            <div><strong>{context.events.length}</strong><span>events</span></div>
            <div><strong>{context.reactions.length}</strong><span>reactions</span></div>
            <div><strong>{context.reactions.reduce((sum, row) => sum + (row.stream?.reader.chunkCount ?? 0), 0)}</strong><span>loaded chunks</span></div>
          </div>
          <div className="panel-title section-title"><span>Sessions</span><Clock3 size={14} /></div>
          <div className="session-list">
            {context.sessions.map(session => (
              <div className="session-row" key={session.id}>
                <StatusDot status={session.status} />
                <div><strong>{session.definition}</strong><span>{time(session.createdAt)} - {session.reactions.length} reactions</span></div>
              </div>
            ))}
          </div>
          <div className="panel-title section-title"><span>Events</span><Activity size={14} /></div>
          <div className="event-list">
            {[...context.events].reverse().slice(0, 30).map(event => (
              <div className="event-row" key={event.id}>
                <span className={`event-marker ${event.durability ?? "durable"}`} />
                <div><strong>{event.type}</strong><span>{short(event.id)} - {event.eventParts.length} parts</span></div>
              </div>
            ))}
          </div>
        </aside>

        <section className="conversation panel">
          <div className="panel-title conversation-title">
            <span>Conversation</span>
            <span className={`send-state send-${context.sendStatus}`}>
              {context.sendStatus === "streaming" ? <Radio size={13} /> : null}
              {context.sendStatus}
            </span>
          </div>
          <div className="messages">
            {conversationSessions.length === 0 && pendingMessages.length === 0 ? (
              <div className="chat-empty"><Bot size={28} /><strong>Start a real Reaction</strong><span>The response will stream through InstantDB while its durable Event is being built.</span></div>
            ) : (
              <>
                {conversationSessions.map(session => (
                  <ConversationTurn
                    key={session.id}
                    session={session}
                    selectedId={selected?.id ?? null}
                    onSelect={setSelectedId}
                  />
                ))}
                {pendingMessages.map(event => (
                  <Message event={event} key={`${event.id}:${event.durability}`} />
                ))}
              </>
            )}
            <div ref={bottom} />
          </div>
          {context.sendError ? <div className="error-banner"><CircleAlert size={15} />{context.sendError}</div> : null}
          <div className="composer-shell">
            <div className="scenario-bar">
              <div className="scenario-control" aria-label="Scenario">
                <button
                  className={scenario === "review" ? "active" : ""}
                  onClick={() => {
                    setScenario("review")
                    if (!draft.trim()) setDraft(REVIEW_SAMPLE)
                  }}
                  type="button"
                ><Network size={13} />Causal review</button>
                <button
                  className={scenario === "chat" ? "active" : ""}
                  onClick={() => {
                    setScenario("chat")
                    if (draft === REVIEW_SAMPLE) setDraft("")
                  }}
                  type="button"
                ><MessageSquare size={13} />Chat</button>
              </div>
              {scenario === "review" ? (
                <button className="load-sample" onClick={() => setDraft(REVIEW_SAMPLE)} type="button">
                  Load sample
                </button>
              ) : null}
              {attachment ? (
                <span className="attachment-chip">
                  <Paperclip size={11} />
                  <span>{attachment.name}</span>
                  <button aria-label="Remove attachment" onClick={() => setAttachment(null)} type="button">
                    <X size={11} />
                  </button>
                </span>
              ) : null}
            </div>
            <form className="composer" onSubmit={submit}>
              <input
                accept=".csv,.json,.md,.pdf,.png,.jpg,.jpeg,.txt"
                hidden
                onChange={event => setAttachment(event.target.files?.[0] ?? null)}
                ref={fileInput}
                type="file"
              />
              <button
                aria-label="Attach file"
                className="attach-button"
                onClick={() => fileInput.current?.click()}
                type="button"
              >
                <Paperclip size={16} />
              </button>
              <textarea
                aria-label="Message"
                placeholder={scenario === "review" ? "Describe a request with concrete items..." : "Ask something that produces a trace..."}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              <button
                aria-label="Send message"
                className="send-button"
                disabled={!draft.trim() || context.sendStatus !== "idle"}
              >
                {context.sendStatus === "idle" ? <ArrowUp size={18} /> : <LoaderCircle className="spin" size={18} />}
              </button>
            </form>
          </div>
        </section>

        <aside className="traces panel">
          <div className="panel-title trace-title">
            <span>Execution</span>
            <div className="trace-tabs" aria-label="Execution view">
              <button
                aria-label="Workflow Gantt"
                className={traceView === "gantt" ? "active" : ""}
                onClick={() => setTraceView("gantt")}
                title="Workflow Gantt"
                type="button"
              ><ChartGantt size={14} /></button>
              <button
                aria-label="Causal graph"
                className={traceView === "graph" ? "active" : ""}
                onClick={() => setTraceView("graph")}
                title="Causal graph"
                type="button"
              ><GitFork size={14} /></button>
            </div>
          </div>
          <div className="reaction-flow">
            {activeSession ? (
              traceView === "gantt" ? (
                <ReactionGanttView
                  session={activeSession}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                />
              ) : (
                <EventTimelineView
                  session={activeSession}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                />
              )
            ) : <div className="empty"><Network size={20} />No Reaction yet.</div>}
          </div>
          <ChunkTrace reaction={selected} />
        </aside>
      </div>
      <div className="terminal-status"><TerminalSquare size={13} />InstantDB is the live transport; Events remain the durable source of truth.</div>
    </main>
  )
}

export function Workbench() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void fetch("/api/bootstrap", { cache: "no-store" })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Bootstrap failed")
        setBootstrap(body)
      })
      .catch(reason => setError(errorText(reason)))
  }, [])

  if (error) return <main className="boot-screen error"><CircleAlert size={26} /><strong>Workbench could not start</strong><pre>{error}</pre></main>
  if (!bootstrap) return <main className="boot-screen"><LoaderCircle className="spin" size={26} /><strong>Provisioning InstantDB</strong><span>Creating the domain graph and stream permissions.</span></main>
  return <LiveWorkbench bootstrap={bootstrap} />
}

function errorText(value: unknown) {
  return value instanceof Error ? value.message : String(value)
}

function fileDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("file_read_failed"))
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.readAsDataURL(file)
  })
}

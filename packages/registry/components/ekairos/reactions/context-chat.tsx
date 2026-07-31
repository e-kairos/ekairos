"use client"

import {
  getPartText,
  INPUT_TEXT_ITEM_TYPE,
  useContext,
  type ContextEventForUI,
  type SendStatus,
  type UseContextOptions,
} from "@ekairos/events/react"
import { type FormEvent, useMemo, useState } from "react"

import "./context-chat.css"

export type ContextChatProps = UseContextOptions & {
  db: any
  className?: string
  emptyLabel?: string
  placeholder?: string
  submitLabel?: string
}

export type MessageListProps = {
  events: readonly ContextEventForUI[]
  emptyLabel?: string
}

export type PromptBarProps = {
  onSubmit(prompt: string): Promise<void> | void
  status: SendStatus
  error?: string | null
  placeholder?: string
  submitLabel?: string
}

export function ContextChat({
  db,
  className,
  emptyLabel,
  placeholder,
  submitLabel,
  ...options
}: ContextChatProps) {
  const context = useContext(db, options)

  return (
    <section className={["context-chat", className].filter(Boolean).join(" ")}>
      <header className="context-chat-header">
        <div>
          <span>Context</span>
          <strong>{context.context?.name ?? context.context?.key ?? context.contextId ?? "New context"}</strong>
        </div>
        <output data-status={context.sendStatus}>{context.sendStatus}</output>
      </header>
      <MessageList events={context.events} emptyLabel={emptyLabel} />
      <PromptBar
        error={context.sendError}
        onSubmit={prompt => context.append({ parts: [{ type: "text", text: prompt }] })}
        placeholder={placeholder}
        status={context.sendStatus}
        submitLabel={submitLabel}
      />
    </section>
  )
}

export function MessageList({
  events,
  emptyLabel = "No events yet.",
}: MessageListProps) {
  const messages = useMemo(() => events.map(event => ({
    event,
    role: event.type === INPUT_TEXT_ITEM_TYPE || event.type.startsWith("user.")
      ? "user"
      : "assistant",
    text: eventText(event),
  })), [events])

  return (
    <div className="context-chat-messages" aria-live="polite">
      {messages.length === 0 ? (
        <p className="context-chat-empty">{emptyLabel}</p>
      ) : messages.map(({ event, role, text }) => (
        <article
          className="context-chat-message"
          data-durability={event.durability ?? "durable"}
          data-role={role}
          key={event.id}
        >
          <header>
            <span>{role}</span>
            <span>{event.durability ?? "durable"}</span>
          </header>
          <p>{text || event.type}</p>
        </article>
      ))}
    </div>
  )
}

export function PromptBar({
  onSubmit,
  status,
  error,
  placeholder = "Message this context…",
  submitLabel = "Send",
}: PromptBarProps) {
  const [draft, setDraft] = useState("")
  const ready = status === "idle" && draft.trim().length > 0

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready) return
    const prompt = draft.trim()
    setDraft("")
    try {
      await onSubmit(prompt)
    } catch {
      setDraft(prompt)
    }
  }

  return (
    <form className="context-chat-prompt" onSubmit={submit}>
      {error ? <p role="alert">{error}</p> : null}
      <div>
        <textarea
          aria-label={placeholder}
          disabled={status !== "idle"}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder={placeholder}
          rows={2}
          value={draft}
        />
        <button disabled={!ready} type="submit">
          {status === "idle" ? submitLabel : status}
        </button>
      </div>
    </form>
  )
}

function eventText(event: ContextEventForUI) {
  const text = event.eventParts.map(getPartText).filter(Boolean).join("\n\n")
  if (text) return text
  if (typeof event.payload === "string") return event.payload
  if (!event.payload || typeof event.payload !== "object") return ""
  const payload = event.payload as Record<string, unknown>
  return typeof payload.text === "string"
    ? payload.text
    : typeof payload.message === "string"
      ? payload.message
      : ""
}

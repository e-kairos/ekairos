"use client"

import { useMemo } from "react"
import { useContext } from "@ekairos/events/react"
import type {
  ContextEventForUI,
  ContextValue,
  UseContextOptions,
} from "@ekairos/events/react"
import type { ChannelMessage } from "@ekairos/channel"

export type ThreadEventForUI = ContextEventForUI & {
  channelMessages?: ChannelMessage[]
}

export type ThreadTimelineEntry =
  | { kind: "event"; at: string; event: ThreadEventForUI }
  | { kind: "message"; at: string; message: ChannelMessage }

export type ThreadMeta = {
  id: string
  key: string | null
  title: string | null
  status: string | null
  createdAt: string
  updatedAt: string | null
  contextId: string
}

export type UseThreadOptions = {
  key: string
  /** Endpoint that runs the application's domain Reaction. */
  apiUrl: string
  onContextUpdate?: UseContextOptions["onContextUpdate"]
  prepareAppendArgs?: UseContextOptions["prepareAppendArgs"]
  prepareRequestBody?: UseContextOptions["prepareRequestBody"]
}

export type ThreadValue = ContextValue & {
  thread: ThreadMeta | null
  messages: ChannelMessage[]
  timeline: ThreadTimelineEntry[]
}

function toMillis(value: string | Date | undefined): number {
  return value ? new Date(value).getTime() : 0
}

function buildTimeline(
  events: ThreadEventForUI[],
  messages: ChannelMessage[],
): ThreadTimelineEntry[] {
  const attached = new Set<string>()
  for (const event of events) {
    for (const message of event.channelMessages ?? []) attached.add(message.id)
  }

  const entries: ThreadTimelineEntry[] = events.map(event => ({
    kind: "event",
    at: new Date(event.createdAt).toISOString(),
    event,
  }))
  for (const message of messages) {
    if (!attached.has(message.id)) {
      entries.push({ kind: "message", at: message.createdAt, message })
    }
  }
  return entries.sort((left, right) => toMillis(left.at) - toMillis(right.at))
}

/**
 * Reactive conversation projection. Appends invoke an application-owned
 * Reaction endpoint; this hook never implements a model loop or writes Events.
 */
export function useThread(db: any, options: UseThreadOptions): ThreadValue {
  const threadQuery = db.useQuery({
    agent_threads: {
      $: { where: { key: options.key } },
      context: {},
    },
  })
  const threadRow = threadQuery?.data?.agent_threads?.[0] ?? null
  const linkedContext = Array.isArray(threadRow?.context)
    ? threadRow.context[0]
    : threadRow?.context
  const contextId: string | null = linkedContext?.id ?? null

  const contextValue = useContext(db, {
    apiUrl: options.apiUrl,
    initialContextId: contextId ?? undefined,
    onContextUpdate: options.onContextUpdate,
    prepareAppendArgs: options.prepareAppendArgs,
    prepareRequestBody: options.prepareRequestBody,
  })

  const messagesQuery = db.useQuery(
    contextId
      ? {
          channel_messages: {
            $: {
              where: { "context.id": contextId },
              order: { createdAt: "asc" as const },
            },
            event: {},
          },
        }
      : null,
  )
  const rawMessages = Array.isArray(messagesQuery?.data?.channel_messages)
    ? messagesQuery.data.channel_messages
    : []
  const messages: ChannelMessage[] = rawMessages.map((row: any) => ({
    ...row,
    eventId: Array.isArray(row.event) ? row.event[0]?.id : row.event?.id,
    contextId: contextId ?? undefined,
  }))

  const thread: ThreadMeta | null = threadRow
    ? {
        id: threadRow.id,
        key: threadRow.key ?? null,
        title: threadRow.title ?? null,
        status: threadRow.status ?? null,
        createdAt: threadRow.createdAt ? new Date(threadRow.createdAt).toISOString() : "",
        updatedAt: threadRow.updatedAt ? new Date(threadRow.updatedAt).toISOString() : null,
        contextId: contextId ?? "",
      }
    : null

  const events: ThreadEventForUI[] = useMemo(
    () => contextValue.events.map(event => ({
      ...event,
      channelMessages: messages.filter(message => message.eventId === event.id),
    })),
    [contextValue.events, messages],
  )
  const timeline = useMemo(() => buildTimeline(events, messages), [events, messages])
  return { ...contextValue, events, thread, messages, timeline }
}

export type { ChannelMessage } from "@ekairos/channel"

import type { ContextEvent } from "@ekairos/events"

export type EventFileOrigin = Readonly<{
  eventId: string
  eventType: string
  link: string
}>

export type EventFileReference = Readonly<{
  fileId: string
  origins: readonly EventFileOrigin[]
}>

export function collectEventFileReferences(
  events: readonly ContextEvent[],
): readonly EventFileReference[] {
  const files = new Map<string, EventFileOrigin[]>()
  for (const event of events) {
    for (const [alias, value] of Object.entries(event.links)) {
      if (event.physicalLinks[alias]?.target !== "$files") continue
      const ids = Array.isArray(value) ? value : [value]
      for (const fileId of ids) {
        if (typeof fileId !== "string" || !fileId) continue
        const origins = files.get(fileId) ?? []
        origins.push(Object.freeze({
          eventId: event.id,
          eventType: event.type,
          link: alias,
        }))
        files.set(fileId, origins)
      }
    }
  }
  return Object.freeze([...files.entries()].map(([fileId, origins]) => Object.freeze({
    fileId,
    origins: Object.freeze(origins),
  })))
}

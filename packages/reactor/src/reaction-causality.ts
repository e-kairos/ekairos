import type { ContextEvent, ContextReaction } from "@ekairos/events"

export async function resolveCausalEvents(input: Readonly<{
  sourceIds: readonly string[]
  getEvent(id: string): Promise<ContextEvent | null>
  getReaction(id: string): Promise<ContextReaction | null>
}>): Promise<readonly ContextEvent[]> {
  const ordered: ContextEvent[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  const visit = async (eventId: string): Promise<void> => {
    if (visited.has(eventId)) return
    if (visiting.has(eventId)) throw new Error(`session_from_cycle:${eventId}`)
    visiting.add(eventId)
    const event = await input.getEvent(eventId)
    if (!event) throw new Error(`session_from_event_not_found:${eventId}`)
    const producerId = typeof event.metadata?.reactionId === "string"
      ? event.metadata.reactionId
      : ""
    if (producerId) {
      const producer = await input.getReaction(producerId)
      if (!producer) throw new Error(`session_from_producer_not_found:${producerId}`)
      for (const causeId of producer.causeIds) await visit(causeId)
      const effectIndex = producer.effectIds.indexOf(eventId)
      if (effectIndex >= 0) {
        for (const precedingId of producer.effectIds.slice(0, effectIndex)) {
          await visit(precedingId)
        }
      }
    } else {
      const causeIds = Array.isArray(event.metadata?.causeIds)
        ? event.metadata.causeIds.filter((id): id is string => typeof id === "string")
        : []
      for (const causeId of causeIds) await visit(causeId)
    }
    visiting.delete(eventId)
    visited.add(eventId)
    ordered.push(event)
  }

  for (const sourceId of input.sourceIds) await visit(sourceId)
  return Object.freeze(ordered)
}

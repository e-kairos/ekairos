import { eventsDomain } from "@ekairos/events"
import { getContextRuntime } from "@ekairos/events/runtime"

export type EventsReactRuntime<Env extends Record<string, unknown>> = {
  env: Env
  db(): Promise<any>
  resolve(): Promise<{
    db: any
    meta: () => {
      domain: typeof eventsDomain
      schema: ReturnType<typeof eventsDomain.toInstantSchema>
      context?: unknown
      contextString?: string
    }
  }>
  meta: () => {
    domain: typeof eventsDomain
    schema: ReturnType<typeof eventsDomain.toInstantSchema>
    context?: unknown
    contextString?: string
  }
}

export function createEventsReactRuntime<Env extends Record<string, unknown>>(
  env: Env,
): EventsReactRuntime<Env> {
  const meta = () => ({
    domain: eventsDomain,
    schema: eventsDomain.toInstantSchema(),
    context: typeof (eventsDomain as any).context === "function" ? (eventsDomain as any).context() : undefined,
    contextString:
      typeof (eventsDomain as any).contextString === "function"
        ? (eventsDomain as any).contextString()
        : undefined,
  })

  const runtime = {
    env,
    async db() {
      const resolved = (await getContextRuntime(env as any)) as any
      return resolved.db
    },
    async resolve() {
      const db = await runtime.db()
      return { db, meta }
    },
    meta,
  }

  return runtime
}

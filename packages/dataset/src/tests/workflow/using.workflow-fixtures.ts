// PRUEBA: `await using` (Symbol.asyncDispose) dentro de "use workflow".
// Evidencia en banda: el orden de `log` viaja en el returnValue del workflow.

import { domain } from "@ekairos/domain"
import { ContextHandle } from "@ekairos/events"
import { Session } from "@ekairos/reactor"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

const sessionScope = domain("usingSessionSerialization")
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .scope({ events: [], actions: [] })

class SerializableRuntime {
  static [WORKFLOW_SERIALIZE]() {
    return {}
  }

  static [WORKFLOW_DESERIALIZE]() {
    return new SerializableRuntime()
  }

  async db() {
    return null
  }

  async use() {
    return null
  }
}

export async function echoStep(value: string): Promise<string> {
  "use step"
  return `step:${value}`
}

function probe(log: string[], stepInDispose: boolean) {
  return {
    async [Symbol.asyncDispose]() {
      if (stepInDispose) {
        // caso agresivo: un "use step" ADENTRO del dispose
        log.push(await echoStep("inside-dispose"))
      }
      log.push("disposed")
    },
  }
}

export async function usingSuccessWorkflow(input: { stepInDispose: boolean }) {
  "use workflow"
  const log: string[] = []
  {
    await using _guard = probe(log, input.stepInDispose)
    log.push("start")
    log.push(await echoStep("body"))
  }
  log.push("after-scope")
  return { log }
}

export async function usingCatchWorkflow() {
  "use workflow"
  const log: string[] = []
  try {
    await using _guard = probe(log, false)
    log.push("start")
    throw new Error("boom")
  } catch (error) {
    log.push(`caught:${(error as Error).message}`)
  }
  return { log }
}

export async function sessionSerializationWorkflow() {
  "use workflow"
  const runtime = new SerializableRuntime()
  const context = new ContextHandle(runtime, {
    id: "context-session-serde",
    key: "context:session-serde",
    content: null,
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
  })
  const session = new Session(runtime, context, {
    scope: sessionScope,
    engine: false,
    sandbox: false,
  })

  const checkpoint = await echoStep("session-checkpoint")
  return {
    checkpoint,
    contextId: session.context.id,
    contextKey: session.context.key,
    disposable: typeof session[Symbol.asyncDispose] === "function",
  }
}

import { defineEvent, domain, EkairosRuntime } from "@ekairos/domain"
import {
  ContextHandle,
  contextDomain,
  Part,
  type ContextEvent,
  type StoredContext,
} from "@ekairos/events"
import { init } from "@instantdb/admin"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { z } from "zod"

import {
  Session,
  type ReactionEngine,
  type ReactionEngineActions,
  type ReactionEngineInput,
} from "../../index.ts"

export type ReactorWorkflowEnv = {
  appId: string
  adminToken: string
}

export type ReactorWorkflowContent = {
  prefix: string
}

const answerSchema = z.object({ message: z.string() })

export const reactorWorkflowDomain = domain("reactorWorkflow")
  .includes(contextDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    requested: defineEvent({ payload: z.object({ message: z.string() }) }),
    completed: defineEvent({ payload: answerSchema }),
  })
const reactorWorkflowScope = reactorWorkflowDomain.scope({
  events: [reactorWorkflowDomain.events.requested],
  actions: [],
})

export class ReactorWorkflowRuntime extends EkairosRuntime<
  ReactorWorkflowEnv,
  typeof reactorWorkflowDomain,
  ReturnType<typeof init>
> {
  static [WORKFLOW_SERIALIZE](instance: ReactorWorkflowRuntime) {
    return this.serializeRuntime(instance)
  }

  static [WORKFLOW_DESERIALIZE](data: { env: ReactorWorkflowEnv }) {
    return this.deserializeRuntime(data) as ReactorWorkflowRuntime
  }

  protected getDomain() {
    return reactorWorkflowDomain
  }

  protected resolveDb(env: ReactorWorkflowEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: reactorWorkflowDomain.instantSchema(),
      useDateObjects: true,
    } as any)
  }
}

export class ReactorWorkflowContext extends ContextHandle<ReactorWorkflowContent> {
  declare readonly runtime: ReactorWorkflowRuntime

  constructor(
    runtime: ReactorWorkflowRuntime,
    context: StoredContext<ReactorWorkflowContent>,
  ) {
    super(runtime, context)
  }

  static [WORKFLOW_SERIALIZE](instance: ReactorWorkflowContext) {
    return { runtime: instance.runtime, context: instance.context }
  }

  static [WORKFLOW_DESERIALIZE](data: {
    runtime: ReactorWorkflowRuntime
    context: StoredContext<ReactorWorkflowContent>
  }) {
    return new ReactorWorkflowContext(data.runtime, data.context)
  }

}

class ReactorWorkflowEngine implements ReactionEngine<ReactorWorkflowContent> {
  static [WORKFLOW_SERIALIZE]() {
    return {}
  }

  static [WORKFLOW_DESERIALIZE]() {
    return new ReactorWorkflowEngine()
  }

  async agent<TOutput, TActions extends ReactionEngineActions>(
    input: ReactionEngineInput<ReactorWorkflowContent, TOutput, TActions>,
  ) {
    const request = reactorWorkflowDomain.events.requested.payload.parse(
      input.trigger.payload,
    )
    const candidate = {
      message: `${input.context.content.prefix}:${request.message}`,
    }
    return {
      output: input.output
        ? input.output.parse(candidate)
        : candidate as TOutput,
      parts: [Part.message(candidate.message)],
    }
  }
}

export async function reactorWorkflow(
  context: ReactorWorkflowContext,
  trigger: ContextEvent,
) {
  "use workflow"

  await using session = new Session(context.runtime, context, {
    scope: reactorWorkflowScope,
    engine: new ReactorWorkflowEngine(),
    sandbox: false,
  })
  const answered = await session.from(trigger).agent({
    instruction: "Answer the persisted request deterministically.",
    output: answerSchema,
  })
  return answered
}

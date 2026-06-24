import { init } from "@instantdb/admin"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { EkairosRuntime } from "@ekairos/domain"

import { contextDomain } from "@ekairos/events/schema"

export type EventsTestRuntimeEnv<Extra extends Record<string, unknown> = {}> = Extra & {
  appId: string
  adminToken: string
}

export class EventsTestRuntime<
  Extra extends Record<string, unknown> = {},
> extends EkairosRuntime<
  EventsTestRuntimeEnv<Extra>,
  typeof contextDomain,
  ReturnType<typeof init>
> {
  static [WORKFLOW_SERIALIZE](instance: EventsTestRuntime<any>) {
    return { env: instance.env }
  }

  static [WORKFLOW_DESERIALIZE](data: { env: EventsTestRuntimeEnv<any> }) {
    return new EventsTestRuntime(data.env)
  }

  protected getDomain() {
    return contextDomain
  }

  protected async resolveDb(env: EventsTestRuntimeEnv<Extra>) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: contextDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }
}

import { init } from "@instantdb/admin"
import { EkairosRuntime } from "@ekairos/domain"

import { contextDomain } from "../schema.js"

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

import { buildReactionDataset } from "@ekairos/dataset"
import { EkairosRuntime } from "@ekairos/domain"
import { init } from "@instantdb/admin"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

import { workbenchDomain, workbenchSchema } from "./domain"

export type WorkbenchRuntimeEnv = {
  appId: string
  adminToken: string
  orgId: string
}

export class WorkbenchRuntime extends EkairosRuntime<
  WorkbenchRuntimeEnv,
  typeof workbenchDomain,
  ReturnType<typeof init>
> {
  static [WORKFLOW_SERIALIZE](instance: WorkbenchRuntime) {
    return { env: instance.env }
  }

  static [WORKFLOW_DESERIALIZE](data: { env: WorkbenchRuntimeEnv }) {
    return new WorkbenchRuntime(data.env)
  }

  protected getDomain() { return workbenchDomain }

  protected async resolveDb(env: WorkbenchRuntimeEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: workbenchSchema,
      useDateObjects: true,
    } as any)
  }

  async materializeDataset(input: Parameters<typeof buildReactionDataset>[0]) {
    return await buildReactionDataset(input)
  }
}

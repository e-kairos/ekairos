import { EkairosRuntime } from "../runtime-handle.js"
import { id, init } from "@instantdb/admin"
import { i } from "@instantdb/core"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { z } from "zod"

import { defineDomainAction, domain, type DomainRuntime } from "../index.js"
import { executeRuntimeAction } from "../runtime.js"
import { readActionExecutionContext } from "./workflow.metadata.js"

const actionExecutionContextSchema = z.object({
  workflowRunId: z.string().nullable(),
  stepId: z.string().nullable(),
  attempt: z.number().nullable(),
  inWorkflow: z.boolean(),
  inStep: z.boolean(),
})

export type RuntimeWorkflowEnv = {
  appId: string
  adminToken: string
  marker: string
}

export async function normalizeProbeLabelExecute(
  { input }: {
    input: { label: string }
    runtime: DomainRuntime<typeof runtimeWorkflowDomain, RuntimeWorkflowEnv>
  },
) {
  const execution = await readActionExecutionContext()
  return {
    label: String(input.label ?? "").trim(),
    execution,
  }
}

export const normalizeProbeLabelAction = defineDomainAction({
  name: "runtime.probe.normalizeLabel",
  input: z.object({ label: z.string() }),
  output: z.object({
    label: z.string(),
    execution: actionExecutionContextSchema,
  }),
  execute: normalizeProbeLabelExecute,
})

export async function createProbeExecute(
  { input, runtime }: {
    input: { probeId: string; label: string }
    runtime: DomainRuntime<typeof runtimeWorkflowDomain, RuntimeWorkflowEnv>
  },
) {
  const execution = await readActionExecutionContext()
  const normalized = await runtime.actions.normalizeProbeLabel({
    label: input.label,
  })
  const rowId = id()

  await runtime.db.transact([
    runtime.db.tx.runtime_probe_rows[rowId].update({
      probeId: input.probeId,
      label: normalized.label,
      createdAt: new Date(),
    }),
  ])

  return {
    rowId,
    probeId: input.probeId,
    label: normalized.label,
    marker: runtime.env.marker,
    runtimeKey: `${runtime.env.appId}:${runtime.env.marker}`,
    isRuntimeInstance: runtime instanceof RuntimeWorkflowTestRuntime,
    execution,
    normalizedExecution: normalized.execution,
  }
}

export const createProbeAction = defineDomainAction({
  name: "runtime.probe.create",
  input: z.object({ probeId: z.string(), label: z.string() }),
  output: z.object({
    rowId: z.string(),
    probeId: z.string(),
    label: z.string(),
    marker: z.string(),
    runtimeKey: z.string(),
    isRuntimeInstance: z.boolean(),
    execution: actionExecutionContextSchema,
    normalizedExecution: actionExecutionContextSchema,
  }),
  execute: createProbeExecute,
})

export async function readProbeExecute(
  { input, runtime }: {
    input: { probeId: string }
    runtime: DomainRuntime<typeof runtimeWorkflowDomain, RuntimeWorkflowEnv>
  },
) {
  const execution = await readActionExecutionContext()
  const query = await runtime.db.query({
    runtime_probe_rows: {
      $: { where: { probeId: input.probeId }, limit: 1 },
    },
  })

  const row = query.runtime_probe_rows?.[0]
  return {
    probeId: row?.probeId ?? null,
    label: row?.label ?? null,
    marker: runtime.env.marker,
    runtimeKey: `${runtime.env.appId}:${runtime.env.marker}`,
    isRuntimeInstance: runtime instanceof RuntimeWorkflowTestRuntime,
    execution,
  }
}

export const readProbeAction = defineDomainAction({
  name: "runtime.probe.read",
  input: z.object({ probeId: z.string() }),
  output: z.object({
    probeId: z.string().nullable(),
    label: z.string().nullable(),
    marker: z.string(),
    runtimeKey: z.string(),
    isRuntimeInstance: z.boolean(),
    execution: actionExecutionContextSchema,
  }),
  execute: readProbeExecute,
})

export const runtimeWorkflowDomain = domain("runtime.workflow.integration")
  .schema({
    entities: {
      runtime_probe_rows: i.entity({
        probeId: i.string().indexed(),
        label: i.string(),
        createdAt: i.date().indexed(),
      }),
    },
    links: {},
    rooms: {},
  })
  .withActions({
    normalizeProbeLabel: normalizeProbeLabelAction,
    createProbe: createProbeAction,
    readProbe: readProbeAction,
  })

export class RuntimeWorkflowTestRuntime extends EkairosRuntime<
  RuntimeWorkflowEnv,
  typeof runtimeWorkflowDomain,
  ReturnType<typeof init>
> {
  static [WORKFLOW_SERIALIZE](instance: RuntimeWorkflowTestRuntime) {
    return this.serializeRuntime(instance)
  }

  static [WORKFLOW_DESERIALIZE](data: { env: RuntimeWorkflowEnv }) {
    return this.deserializeRuntime(data) as RuntimeWorkflowTestRuntime
  }

  protected getDomain() {
    return runtimeWorkflowDomain
  }

  protected async resolveDb(env: RuntimeWorkflowEnv) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: runtimeWorkflowDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }

  public key() {
    return `${this.env.appId}:${this.env.marker}`
  }
}

export async function executeRuntimeActionWorkflow(
  runtime: RuntimeWorkflowTestRuntime,
  params: { probeId: string; label: string },
) {
  "use workflow"

  const created = await executeRuntimeAction({
    runtime,
    action: createProbeAction,
    input: params,
  })

  const read = await executeRuntimeAction({
    runtime,
    action: readProbeAction,
    input: { probeId: params.probeId },
  })

  return {
    rootRuntimeKey: runtime.key(),
    rootMarker: runtime.env.marker,
    created,
    read,
  }
}

export async function scopedDomainActionsWorkflow(
  runtime: RuntimeWorkflowTestRuntime,
  params: { probeId: string; label: string },
) {
  "use workflow"

  const scoped = await runtime.use(runtimeWorkflowDomain)
  const created = await scoped.actions.createProbe(params)
  const read = await scoped.actions.readProbe({ probeId: params.probeId })

  return {
    rootRuntimeKey: runtime.key(),
    rootMarker: runtime.env.marker,
    created,
    read,
  }
}

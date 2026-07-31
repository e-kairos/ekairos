import "server-only"

import { Context } from "@ekairos/context"
import { Sandbox } from "@ekairos/sandbox"
import { createTestApp } from "@ekairos/testing/provision"

import { workbenchSchema } from "./domain"
import { WorkbenchRuntime } from "./runtime"
import { resolveSandboxLease } from "./sandbox-lifecycle"

type RuntimeProvision = Readonly<{
  appId: string
  adminToken: string
  orgId: string
  sandboxId: string
  sandboxProvider: "daytona"
}>

const STATE = Symbol.for("ekairos.workbench-v3.runtime")
const SANDBOX_REFRESH = Symbol.for("ekairos.workbench-v3.sandbox-refresh")
type RuntimeGlobal = typeof globalThis & {
  [STATE]?: Promise<RuntimeProvision>
  [SANDBOX_REFRESH]?: Promise<RuntimeProvision>
}

function personalAccessToken() {
  return String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
}

async function createWorkbenchSandbox(runtime: WorkbenchRuntime) {
  return await Sandbox.create(runtime, {
    provider: "daytona",
    runtime: "python3.12",
    purpose: "workbench.reaction",
    dataset: { enabled: true },
    daytona: {
      language: "python",
      ephemeral: true,
      autoStopIntervalMin: 30,
    },
  })
}

async function provision(): Promise<RuntimeProvision> {
  const token = personalAccessToken()
  if (!token) throw new Error("INSTANT_PERSONAL_ACCESS_TOKEN is required")
  const app = await createTestApp({
    token,
    name: `ekairos-workbench-v3-${Date.now()}`,
    schema: workbenchSchema as any,
    perms: {
      $default: { allow: { $default: "true" } },
      $streams: { allow: { view: "true" } },
    } as any,
  })
  const orgId = `workbench:${app.appId}`
  const runtime = new WorkbenchRuntime({
    appId: app.appId,
    adminToken: app.adminToken,
    orgId,
  })
  const sandbox = await createWorkbenchSandbox(runtime)
  return Object.freeze({
    ...app,
    orgId,
    sandboxId: sandbox.id,
    sandboxProvider: "daytona" as const,
  })
}

export async function getWorkbenchRuntime() {
  const root = globalThis as RuntimeGlobal
  root[STATE] ??= provision()
  const provisioned = await root[STATE]
  return {
    ...provisioned,
    runtime: new WorkbenchRuntime({
      appId: provisioned.appId,
      adminToken: provisioned.adminToken,
      orgId: provisioned.orgId,
    }),
  }
}

export async function ensureWorkbenchSandbox(runtime: WorkbenchRuntime): Promise<string> {
  const root = globalThis as RuntimeGlobal
  root[STATE] ??= provision()
  root[SANDBOX_REFRESH] ??= (async () => {
    const current = await root[STATE]!
    const resolved = await resolveSandboxLease(current.sandboxId, {
      probe: async sandboxId => {
        const sandbox = await Sandbox.open(runtime, sandboxId)
        const result = await sandbox.exec({ command: "true" })
        return {
          success: result.success,
          ...(result.error ? { error: result.error } : {}),
        }
      },
      create: async () => (await createWorkbenchSandbox(runtime)).id,
    })
    if (!resolved.replaced) return current

    const replacement = Object.freeze({
      ...current,
      sandboxId: resolved.sandboxId,
    })
    root[STATE] = Promise.resolve(replacement)
    return replacement
  })()

  try {
    return (await root[SANDBOX_REFRESH]).sandboxId
  } finally {
    delete root[SANDBOX_REFRESH]
  }
}

export async function ensureWorkbenchContext() {
  const state = await getWorkbenchRuntime()
  const context = await Context(state.runtime).open("workbench-v3-chat")
  return { ...state, context }
}

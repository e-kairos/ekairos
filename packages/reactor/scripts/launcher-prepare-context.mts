/**
 * Prepara un CONTEXTO del launcher local usando la maquinaria real de
 * ekairos-base: defineReaction + executeReaction con un sandbox provider
 * "local" (este filesystem). El layout resultante es el canónico de
 * ekairos-base: <root>/contexts/<contextId>/repositories/<key>/checkout
 * (+ repository.json), por lo que cualquier reacción posterior (git,
 * dataset, shell, agent) puede operar sobre la misma carpeta.
 *
 * Estado persistente (app Instant del launcher + sandbox + contextos):
 *   ~/.ekairos/launcher-contexts.json
 *
 * Uso (desde ekairos-base):
 *   node_modules/.bin/tsx packages/reactor/scripts/launcher-prepare-context.mts \
 *     --name feature-x [--root C:/ekairos-projects/contexts] \
 *     [--repo <url|path>] [--key ekairos-core] [--ref main] [--depth 1]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { resolve, join } from "node:path"

import { config as dotenvConfig } from "dotenv"
import { init } from "@instantdb/admin"
import { z } from "zod"

import { EkairosRuntime, defineEvent, domain } from "@ekairos/domain"
import { ContextHandle, Events, contextDomain } from "@ekairos/events"
import { Sandbox, sandboxDomain } from "@ekairos/sandbox"
import { defineReaction } from "@ekairos/reactor"
import { executeReaction } from "@ekairos/reactor/internal"

const BASE_ROOT = resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1"))
for (const envPath of [
  join(BASE_ROOT, ".env.local"),
  join(BASE_ROOT, "..", "ekairos-core", ".env.local"),
]) {
  dotenvConfig({ path: envPath, quiet: true })
}

// ── argumentos ─────────────────────────────────────────────────────────
function arg(flag: string, fallback?: string) {
  const index = process.argv.indexOf(`--${flag}`)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  return fallback
}

const contextName = arg("name")
if (!contextName) {
  console.error("uso: launcher-prepare-context --name <contexto> [--root <dir>] [--repo <url>] [--key <clave>] [--ref <rama>] [--depth <n>]")
  process.exit(2)
}
const workspaceRoot = resolve(arg("root", "C:/ekairos-projects")!)
const repoUrl = arg("repo", "C:/ekairos-projects/workspace/ekairos-core")!
const repoKey = arg("key", "ekairos-core")!
const repoRef = arg("ref")
const repoDepth = arg("depth")

// ── dominio del launcher ───────────────────────────────────────────────
const launcherDomain = domain("launcher")
  .includes(contextDomain)
  .includes(sandboxDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withActions(sandboxDomain.actions)
  .withEvents({
    prepareRequested: defineEvent({
      payload: z.object({
        contextName: z.string(),
        repo: z.string(),
        key: z.string(),
      }),
    }),
  })

type Env = { appId: string; adminToken: string }

class LauncherRuntime extends EkairosRuntime<Env, typeof launcherDomain, ReturnType<typeof init>> {
  protected getDomain() {
    return launcherDomain
  }
  protected async resolveDb(env: Env) {
    return init({ ...env, schema: launcherDomain.instantSchema(), useDateObjects: true } as any)
  }
}

// ── estado persistente del launcher ────────────────────────────────────
type LauncherState = {
  app?: { appId: string; adminToken: string }
  sandboxId?: string
  workspaceRoot?: string
  contexts?: Record<string, { contextId: string }>
}

const STATE_PATH = join(homedir(), ".ekairos", "launcher-contexts.json")

async function loadState(): Promise<LauncherState> {
  try {
    return JSON.parse((await readFile(STATE_PATH, "utf8")).replace(/^﻿/, ""))
  } catch {
    return {}
  }
}

async function saveState(state: LauncherState) {
  await mkdir(join(homedir(), ".ekairos"), { recursive: true })
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8")
}

async function ensureLauncherApp(state: LauncherState): Promise<Env> {
  if (state.app?.appId && state.app?.adminToken) return state.app
  const token = String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
  if (!token) throw new Error("INSTANT_PERSONAL_ACCESS_TOKEN requerido para provisionar la app del launcher")
  console.log("◆ provisionando app Instant del launcher (una sola vez)…")
  const { createTestApp } = await import("../../ekairos-test/src/provision.ts")
  const app = await createTestApp({
    name: "ekairos-launcher-contexts",
    token,
    schema: launcherDomain.instantSchema() as any,
  })
  state.app = { appId: app.appId, adminToken: app.adminToken }
  await saveState(state)
  console.log(`◆ app del launcher: ${app.appId}`)
  return state.app
}

async function ensureLocalSandbox(runtime: LauncherRuntime, state: LauncherState): Promise<string> {
  if (state.sandboxId && state.workspaceRoot === workspaceRoot) {
    try {
      await Sandbox.open(runtime as any, state.sandboxId)
      return state.sandboxId
    } catch {
      // registro perdido → recrear
    }
  }
  const sandbox = await Sandbox.create(runtime as any, {
    provider: "local",
    purpose: "launcher-contexts",
    params: { workspaceRoot },
  } as any)
  state.sandboxId = sandbox.sandboxId
  state.workspaceRoot = workspaceRoot
  await saveState(state)
  console.log(`◆ sandbox local: ${sandbox.sandboxId} → ${workspaceRoot}`)
  return sandbox.sandboxId
}

async function ensureContext(runtime: LauncherRuntime, state: LauncherState) {
  const existing = state.contexts?.[contextName!]
  if (existing?.contextId) {
    const handle = await ContextHandle.get(runtime as any, { id: existing.contextId } as any)
    if (handle) return handle
  }
  const handle = await ContextHandle.create(runtime as any, {
    key: `launcher:${contextName}`,
    name: contextName!,
    content: { contextName, workspaceRoot },
  })
  state.contexts = { ...(state.contexts ?? {}), [contextName!]: { contextId: handle.id } }
  await saveState(state)
  return handle
}

// ── ejecución ──────────────────────────────────────────────────────────
async function main() {
  await mkdir(workspaceRoot, { recursive: true })
  const state = await loadState()
  const env = await ensureLauncherApp(state)
  const runtime = new LauncherRuntime(env)
  const sandboxId = await ensureLocalSandbox(runtime, state)
  const context = await ensureContext(runtime, state)
  console.log(`◆ contexto "${contextName}": ${context.id}`)

  const definition = defineReaction(
    launcherDomain.events.prepareRequested,
    {
      key: "launcher.prepareContext",
      scope: launcherDomain,
      engine: false,
      sandbox: sandboxId,
    },
    async (reaction) => {
      console.log(`◆ git clone ${repoUrl} (key ${repoKey}${repoRef ? `, ref ${repoRef}` : ""})…`)
      const clone = await reaction.given(reaction.trigger).git({
        operation: "clone",
        key: repoKey,
        url: repoUrl,
        ...(repoRef ? { ref: repoRef } : {}),
        ...(repoDepth ? { depth: Number(repoDepth) } : {}),
      })
      return clone
    },
  )

  const trigger = await Events(runtime as any).emit(
    launcherDomain.events.prepareRequested({
      contextName: contextName!,
      repo: repoUrl,
      key: repoKey,
    }),
    { contextId: context.id, channel: "launcher" },
  )

  const result: any = await executeReaction(runtime as any, context as any, trigger, definition as any)
  const checkout = join(workspaceRoot, "contexts", context.id, "repositories", repoKey, "checkout")
  const cloneOut = (result?.payload ?? result) as any
  console.log(`◆ ${cloneOut?.status ?? "ok"} · ${cloneOut?.commitSha ?? ""}`)
  console.log(`LAUNCHER_RESULT ${JSON.stringify({
    contextName,
    contextId: context.id,
    sandboxId,
    checkout,
    status: cloneOut?.status ?? "ok",
    commitSha: cloneOut?.commitSha ?? null,
  })}`)
}

main().catch((error) => {
  console.error(`✖ ${error?.message ?? error}`)
  process.exit(1)
})

import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { init } from "@instantdb/admin"
import { defineAction, defineEvent, domain, EkairosRuntime } from "@ekairos/domain"
import { Context } from "@ekairos/context"
import { Events, contextDomain } from "@ekairos/events"
import { defineLabCodingReaction, type LabCodingContext } from "@ekairos/lab"
import type { ReactionEngine, ReactionEngineInput } from "@ekairos/reactor"
import { sandboxSchemaDomain } from "@ekairos/sandbox/schema"
import { createTestApp, destroyTestApp } from "@ekairos/testing/provision"
import { config as dotenvConfig } from "dotenv"
import { z } from "zod"
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest"

const envRoots = [
  process.cwd(),
  resolve(process.cwd(), ".."),
  resolve(process.cwd(), "..", ".."),
  resolve(process.cwd(), "..", "..", ".."),
  resolve(process.cwd(), "..", "ekairos-core"),
  resolve(process.cwd(), "..", "..", "ekairos-core"),
  resolve(process.cwd(), "..", "..", "..", "ekairos-core"),
]

for (const root of envRoots) {
  dotenvConfig({ path: resolve(root, ".env.local"), quiet: true })
  dotenvConfig({ path: resolve(root, ".env"), quiet: true })
}

function getInstantProvisionToken() {
  return String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim()
}

const describeInstant = getInstantProvisionToken() ? describe : describe.skip
const itInstant = getInstantProvisionToken() ? it : it.skip

type SandboxCall = { command: string; args?: string[]; cwd?: string }
const sandboxCalls: SandboxCall[] = []

const runCommandProcess = defineAction({
  input: z.object({
    sandboxId: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
  }).passthrough(),
  output: z.any(),
  async execute({ input }) {
    sandboxCalls.push({ command: input.command, args: input.args, cwd: input.cwd })
    const command = [input.command, ...(input.args ?? [])].join(" ")
    let success = true
    let exitCode = 0
    let output = "ok\n"
    let error = ""

    if (
      input.command === "test" &&
      input.args?.[0] === "-e" &&
      input.args?.[1]?.endsWith("/.git")
    ) {
      success = false
      exitCode = 1
      output = ""
    } else if (input.command === "git" && input.args?.includes("--is-inside-work-tree")) {
      success = false
      exitCode = 128
      output = ""
      error = "not a repo"
    } else if (input.command === "git" && input.args?.[0] === "clone") {
      output = "cloned\n"
    } else if (input.command === "git" && input.args?.includes("status")) {
      output = " M README.md\n"
    } else if (input.command === "git" && input.args?.includes("add")) {
      output = ""
    } else if (input.command === "git" && input.args?.includes("commit")) {
      output = "[main abc123] smoke\n"
    } else if (input.command === "git" && input.args?.includes("push")) {
      output = "pushed\n"
    } else if (input.command === "git" && input.args?.includes("rev-parse")) {
      output = "abc123\n"
    }

    const processId = `process-${randomUUID()}`
    return {
      ok: true,
      data: {
        processId,
        streamId: `stream-${processId}`,
        streamClientId: `sandbox-process:${processId}`,
        result: { success, exitCode, output, error, command },
      },
    }
  },
})

const writeFiles = defineAction({
  input: z.object({
    sandboxId: z.string(),
    files: z.array(z.object({
      path: z.string(),
      contentBase64: z.string(),
    })),
  }),
  output: z.any(),
  async execute() {
    return { ok: true, data: undefined }
  },
})

const readFile = defineAction({
  input: z.object({ sandboxId: z.string(), path: z.string() }),
  output: z.any(),
  async execute() {
    return { ok: true, data: { contentBase64: "" } }
  },
})

const stopSandbox = defineAction({
  input: z.object({ sandboxId: z.string() }),
  output: z.any(),
  async execute() {
    return { ok: true, data: undefined }
  },
})

const labSmokeDomain = domain("labSmoke")
  .includes(contextDomain)
  .includes(sandboxSchemaDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    codingRequested: defineEvent({ payload: z.object({ request: z.string() }) }),
    codingCompleted: defineEvent({ payload: z.any() }),
  })
  .withActions({ runCommandProcess, writeFiles, readFile, stopSandbox })

class LabSmokeRuntime extends EkairosRuntime<
  { appId: string; adminToken: string },
  typeof labSmokeDomain,
  ReturnType<typeof init>
> {
  protected getDomain() {
    return labSmokeDomain
  }

  protected async resolveDb(env: { appId: string; adminToken: string }) {
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: labSmokeDomain.instantSchema(),
      useDateObjects: true,
    } as any)
  }
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value as Record<string, unknown>[] : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

describeInstant("lab coding reaction smoke", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>

  beforeAll(async () => {
    const app = await createTestApp({
      name: "lab-smoke",
      token: getInstantProvisionToken(),
      schema: labSmokeDomain.instantSchema() as any,
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({
      appId,
      adminToken,
      schema: labSmokeDomain.instantSchema(),
      useDateObjects: true,
    } as any)
  }, 60_000)

  afterAll(async () => {
    const token = getInstantProvisionToken()
    if (appId && token) {
      await destroyTestApp({ appId, token })
    }
  }, 60_000)

  itInstant("clones, inspects, runs the AI step, and persists the execution trace", async () => {
    const runtime = new LabSmokeRuntime({ appId, adminToken })
    const sandboxId = randomUUID()
    const contextKey = `lab-smoke:repository:${randomUUID()}`
    const context = await Context(runtime).create({
      key: contextKey,
      content: {
        repositoryUrl: "https://github.com/e-kairos/ekairos-lab-smoke",
        repositoryRef: "main",
        repositoryPath: "ekairos-lab-smoke",
        request: "Update README.md with a smoke marker.",
        commitMessage: "test: update lab smoke readme",
        push: {
          remote: "origin",
          branch: `lab-smoke-${randomUUID()}`,
        },
      },
    })
    await db.transact([
      db.tx.sandbox_sandboxes[sandboxId].update({
        provider: "local",
        externalSandboxId: sandboxId,
        status: "running",
        createdAt: Date.now(),
        params: { workspaceRoot: "/workspace" },
      }),
    ])
    const triggerEvent = await Events(runtime).emit(
      labSmokeDomain.events.codingRequested({ request: "Update the README." }),
      {
        id: randomUUID(),
        contextId: context.id,
        channel: "web",
        createdAt: new Date(),
      },
    )

    sandboxCalls.length = 0
    const engine: ReactionEngine<LabCodingContext> = {
      async agent<TOutput>(input: ReactionEngineInput<LabCodingContext, TOutput>) {
        const inspected = input.given[input.given.length - 1]
        const candidate = {
          status: "completed",
          summary: "Smoke coding task completed after clone and inspection.",
          repositoryPath: input.context.content.repositoryPath,
          changedFiles: ["README.md"],
          verification: String(asRecord(inspected?.payload).output ?? "").trim(),
        }
        return { output: input.output!.parse(candidate) }
      },
    }
    const reaction = defineLabCodingReaction({
      trigger: labSmokeDomain.events.codingRequested,
      scope: labSmokeDomain,
      engine,
      sandbox: sandboxId,
      completed: result => labSmokeDomain.events.codingCompleted(result),
    })

    const effect = await context.react(triggerEvent, reaction)

    expect(effect.payload.status).toBe("completed")
    expect(effect.payload.repositoryPath).toContain("ekairos-lab-smoke")
    expect(effect.payload.commit?.status).toBe("committed")
    expect(effect.payload.push?.status).toBe("pushed")
    expect(sandboxCalls.some((call) => call.command === "git" && call.args?.[0] === "clone")).toBe(true)
    expect(sandboxCalls.some((call) => call.command === "git" && call.args?.includes("status"))).toBe(true)
    expect(sandboxCalls.some((call) => call.command === "git" && call.args?.includes("commit"))).toBe(true)
    expect(sandboxCalls.some((call) => call.command === "git" && call.args?.includes("push"))).toBe(true)

    const snapshot = await db.query({
      context_contexts: {
        $: { where: { key: contextKey }, limit: 1 },
        sessions: {
          rootReaction: { effects: {} },
          reactions: { effects: { eventParts: {} } },
        },
      },
    } as any)

    const storedContext = asRows((snapshot as any).context_contexts)[0]
    const session = asRows(storedContext?.sessions)[0]
    const reactions = asRows(session?.reactions)
      .sort((left, right) => Number(left.position) - Number(right.position))
    expect(reactions.map((entry) => entry.type)).toEqual([
      "lab.coding",
      "git.clone",
      "shell",
      "agent",
      "git.commit",
      "git.push",
      "emit",
    ])
    expect(reactions.every((entry) => entry.status === "completed")).toBe(true)
    const root = asRecord(
      Array.isArray(session?.rootReaction)
        ? session.rootReaction[0]
        : session?.rootReaction,
    )
    const storedEffect = asRows(root.effects)[0]
    expect(asRecord(storedEffect?.payload).status).toBe("completed")
  }, 60_000)
})

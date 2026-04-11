/* @vitest-environment node */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createServer } from "node:http"
import { once } from "node:events"
import { tmpdir } from "node:os"
import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { init, id as newId } from "@instantdb/admin"
import { i } from "@instantdb/core"

import { createTestApp, destroyTestApp } from "@ekairos/testing/provision"

import { defineDomainAction, domain } from "../index.js"
import { configureRuntime } from "../runtime.js"
import { runCli, handleDomainCliGet, handleDomainCliPost } from "../cli/index.js"

function hasInstantProvisionToken() {
  return Boolean(String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim())
}

type CliEnv = {
  actorId?: string
  actorEmail?: string | null
  refreshToken?: string
  appId?: string
}

const describeCliE2E = hasInstantProvisionToken() ? describe : describe.skip

describeCliE2E("domain cli", () => {
  let appId = ""
  let adminToken = ""
  let refreshToken = ""
  let userId = ""
  let baseUrl = ""
  let cliHome = ""
  let server: ReturnType<typeof createServer> | null = null
  let previousCliHome = ""
  let previousDomainAppId = ""

  const baseDomain = domain("cli.demo").schema({
    entities: {
      cli_tasks: i.entity({
        title: i.string().indexed(),
        createdAt: i.number().indexed(),
      }),
    },
    links: {
      cliTaskCreator: {
        forward: { on: "cli_tasks", has: "one", label: "creator" },
        reverse: { on: "$users", has: "many", label: "cliTasks" },
      },
    },
    rooms: {},
  })

  let appDomain: any
  appDomain = baseDomain.actions({
    createTask: defineDomainAction<CliEnv, { title: string }, { taskId: string; title: string; actorId: string | null }, any, any>({
      name: "cli.task.create",
      async execute({ runtime, input, env }) {
        "use step"
        const domain = await runtime.use(appDomain)
        const taskId = newId()
        const actorId = String(env.actorId ?? "").trim() || null
        const mutations: any[] = [
          domain.db.tx.cli_tasks[taskId].update({
            title: String(input.title ?? "").trim(),
            createdAt: Date.now(),
          }),
        ]
        if (actorId) {
          mutations.push(domain.db.tx.cli_tasks[taskId].link({ creator: actorId }))
        }
        await domain.db.transact(mutations)
        return {
          taskId,
          title: String(input.title ?? "").trim(),
          actorId,
        }
      },
    }),
  })

  beforeAll(async () => {
    const app = await createTestApp({
      name: `domain-cli-${Date.now()}`,
      token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim(),
      schema: appDomain.toInstantSchema(),
      perms: {
        attrs: {
          allow: { create: "true" },
        },
        cli_tasks: {
          bind: ["isLoggedIn", "auth.id != null"],
          allow: {
            view: "isLoggedIn",
            create: "isLoggedIn",
            update: "isLoggedIn",
            delete: "false",
          },
        },
      } as any,
    })

    appId = app.appId
    adminToken = app.adminToken
    const db = init({
      appId,
      adminToken,
      schema: appDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)

    userId = newId()
    refreshToken = await db.auth.createToken({ id: userId })

    configureRuntime({
      domain: { domain: appDomain },
      runtime: async () => ({ db } as any),
    })

    previousCliHome = String(process.env.EKAIROS_DOMAIN_CLI_HOME ?? "")
    previousDomainAppId = String(process.env.EKAIROS_DOMAIN_APP_ID ?? "")
    cliHome = resolve(tmpdir(), `ekairos-domain-cli-${Date.now()}`)
    process.env.EKAIROS_DOMAIN_CLI_HOME = cliHome
    process.env.EKAIROS_DOMAIN_APP_ID = appId

    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`)
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }

      const request = new Request(url, {
        method: req.method,
        headers: req.headers as any,
        body:
          req.method && ["GET", "HEAD"].includes(req.method.toUpperCase())
            ? undefined
            : Buffer.concat(chunks),
      })

      const response =
        req.method === "GET"
          ? await handleDomainCliGet(request)
          : await handleDomainCliPost(request)

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
      const body = Buffer.from(await response.arrayBuffer())
      res.end(body)
    })

    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind test server")
    }
    baseUrl = `http://127.0.0.1:${address.port}`
  }, 5 * 60 * 1000)

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolveClose) => server!.close(() => resolveClose()))
    }
    await rm(cliHome, { recursive: true, force: true }).catch(() => {})
    if (previousCliHome) {
      process.env.EKAIROS_DOMAIN_CLI_HOME = previousCliHome
    } else {
      delete process.env.EKAIROS_DOMAIN_CLI_HOME
    }
    if (previousDomainAppId) {
      process.env.EKAIROS_DOMAIN_APP_ID = previousDomainAppId
    } else {
      delete process.env.EKAIROS_DOMAIN_APP_ID
    }
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyTestApp({
        appId,
        token: String(process.env.INSTANT_PERSONAL_ACCESS_TOKEN ?? "").trim(),
      }).catch(() => {})
    }
  }, 5 * 60 * 1000)

  function createIo() {
    let stdout = ""
    let stderr = ""
    return {
      io: {
        stdout: {
          write(chunk: string) {
            stdout += chunk
            return true
          },
        },
        stderr: {
          write(chunk: string) {
            stderr += chunk
            return true
          },
        },
      },
      read: () => ({ stdout, stderr }),
    }
  }

  it("logs in, inspects the domain, executes an action, and queries via the client runtime", async () => {
    const loginIo = createIo()
    const loginCode = await runCli(
      ["login", baseUrl, `--refreshToken=${refreshToken}`, `--appId=${appId}`],
      loginIo.io as any,
    )
    expect(loginCode, JSON.stringify(loginIo.read())).toBe(0)
    const loginPayload = JSON.parse(loginIo.read().stdout)
    expect(loginPayload.ok).toBe(true)
    expect(loginPayload.baseUrl).toBe(baseUrl)
    expect(loginPayload.appId).toBe(appId)
    expect(loginPayload.actor.id).toBe(userId)

    const inspectIo = createIo()
    const inspectCode = await runCli(["inspect"], inspectIo.io as any)
    expect(inspectCode).toBe(0)
    const inspectPayload = JSON.parse(inspectIo.read().stdout)
    expect(Array.isArray(inspectPayload.entities)).toBe(true)
    expect(inspectPayload.entities).toContain("cli_tasks")
    expect(Array.isArray(inspectPayload.actions)).toBe(true)
    expect(
      inspectPayload.actions.some((entry: any) => entry.key === "createTask" || entry.name === "cli.task.create"),
    ).toBe(true)

    const actionIo = createIo()
    const actionCode = await runCli(
      ["createTask", '{"title":"Ship CLI adapter"}'],
      actionIo.io as any,
    )
    expect(actionCode, JSON.stringify(actionIo.read())).toBe(0)
    const actionPayload = JSON.parse(actionIo.read().stdout)
    expect(actionPayload.ok, JSON.stringify(actionPayload)).toBe(true)
    expect(actionPayload.action).toBe("cli.task.create")
    expect(actionPayload.output.title).toBe("Ship CLI adapter")
    expect(actionPayload.output.actorId).toBe(userId)

    const queryIo = createIo()
    const queryCode = await runCli(
      [
        "query",
        '{"cli_tasks":{"$":{"order":{"createdAt":"asc"},"limit":10},"creator":{}}}',
      ],
      queryIo.io as any,
    )
    expect(queryCode, JSON.stringify(queryIo.read())).toBe(0)
    const queryPayload = JSON.parse(queryIo.read().stdout)
    expect(Array.isArray(queryPayload.cli_tasks)).toBe(true)
    expect(queryPayload.cli_tasks).toHaveLength(1)
    expect(queryPayload.cli_tasks[0].title).toBe("Ship CLI adapter")
    const creator = Array.isArray(queryPayload.cli_tasks[0].creator)
      ? queryPayload.cli_tasks[0].creator[0]
      : queryPayload.cli_tasks[0].creator
    expect(String(creator?.id ?? "")).toBe(userId)
  }, 5 * 60 * 1000)
})

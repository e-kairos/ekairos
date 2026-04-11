#!/usr/bin/env node
import { read } from "node:fs"
import { stdin as input, stdout as output } from "node:process"
import readline from "node:readline/promises"
import {
  clearCliSession,
  fetchDomainManifest,
  normalizeBaseUrl,
  postDomainAction,
  readCliSession,
  writeCliSession,
  ClientRuntime,
} from "./index.js"

type CliContext = {
  stdout: Pick<typeof output, "write">
  stderr: Pick<typeof output, "write">
}

function printHelp(ctx: CliContext) {
  ctx.stdout.write(
    [
      "ekairos-domain",
      "",
      "Commands:",
      "  login <baseUrl> [--refreshToken=<token>] [--appId=<appId>]",
      "  inspect [filter]",
      "  query <json>",
      "  action <name> <json> [--env=<json>]",
      "  logout",
      "",
      "Shorthand:",
      "  ekairos-domain <actionName> <json> [--env=<json>]",
      "",
    ].join("\n"),
  )
}

function parseFlags(argv: string[]) {
  const positionals: string[] = []
  const flags = new Map<string, string | boolean>()

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }
    const [name, rawValue] = arg.slice(2).split("=", 2)
    flags.set(name, rawValue === undefined ? true : rawValue)
  }

  return { positionals, flags }
}

function flagValue(flags: Map<string, string | boolean>, names: string[]) {
  for (const name of names) {
    if (flags.has(name)) return flags.get(name)
  }
  return undefined
}

function parseJsonInput(raw: string | undefined, label: string) {
  const text = String(raw ?? "").trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function promptRefreshToken(): Promise<string> {
  const rl = readline.createInterface({ input, output })
  try {
    const value = await rl.question("Instant refresh token: ")
    return String(value ?? "").trim()
  } finally {
    rl.close()
  }
}

function pretty(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function resolveSession(flags: Map<string, string | boolean>) {
  const stored = await readCliSession()
  const baseUrlFlag = flagValue(flags, ["baseUrl", "base-url"])
  const appIdFlag = flagValue(flags, ["appId", "app-id"])
  const refreshTokenFlag = flagValue(flags, ["refreshToken", "refresh-token"])
  const apiURIFlag = flagValue(flags, ["apiURI", "api-uri"])

  const refreshToken =
    typeof refreshTokenFlag === "string"
      ? refreshTokenFlag
      : String(process.env.EKAIROS_REFRESH_TOKEN ?? "").trim() || stored?.refreshToken || ""

  return {
    baseUrl:
      typeof baseUrlFlag === "string"
        ? normalizeBaseUrl(baseUrlFlag)
        : stored?.baseUrl || "",
    appId:
      typeof appIdFlag === "string" ? appIdFlag : stored?.appId || "",
    refreshToken,
    apiURI:
      typeof apiURIFlag === "string"
        ? apiURIFlag
        : stored?.apiURI || "https://api.instantdb.com",
  }
}

async function commandLogin(args: string[], ctx: CliContext) {
  const { positionals, flags } = parseFlags(args)
  const baseUrl = normalizeBaseUrl(positionals[0] ?? "")
  let refreshToken = String(flagValue(flags, ["refreshToken", "refresh-token"]) ?? "").trim()
  if (!refreshToken) {
    refreshToken = String(process.env.EKAIROS_REFRESH_TOKEN ?? "").trim()
  }
  if (!refreshToken) {
    refreshToken = await promptRefreshToken()
  }
  if (!refreshToken) {
    throw new Error("refreshToken is required")
  }

  const manifest = await fetchDomainManifest({ baseUrl, refreshToken })
  const appId =
    String(flagValue(flags, ["appId", "app-id"]) ?? "").trim() ||
    String(manifest.instant.appId ?? "").trim()
  if (!appId) {
    throw new Error("appId is required. Pass --appId=... or expose it from the domain endpoint.")
  }

  const runtime = new ClientRuntime({
    appId,
    refreshToken,
    apiURI: String(manifest.instant.apiURI ?? "https://api.instantdb.com"),
  })
  const user = await runtime.verify()

  await writeCliSession({
    version: 1,
    baseUrl,
    appId,
    refreshToken,
    apiURI: runtime.apiURI,
    savedAt: new Date().toISOString(),
  })

  ctx.stdout.write(
    pretty({
      ok: true,
      baseUrl,
      appId,
      actor: {
        id: user.id,
        email: user.email ?? null,
        isGuest: user.isGuest,
      },
      entities: Array.isArray((manifest.domain as any)?.entities)
        ? (manifest.domain as any).entities.length
        : null,
      actions: manifest.actions.map((action) => action.key || action.name),
    }),
  )
}

async function commandInspect(args: string[], ctx: CliContext) {
  const { positionals, flags } = parseFlags(args)
  const session = await resolveSession(flags)
  if (!session.baseUrl) throw new Error("No saved session. Run login first.")
  const manifest = await fetchDomainManifest({
    baseUrl: session.baseUrl,
    refreshToken: session.refreshToken,
  })
  const filter = String(positionals[0] ?? "").trim().toLowerCase()
  const actions = manifest.actions.filter((action) => {
    if (!filter) return true
    return (
      String(action.name ?? "").toLowerCase().includes(filter) ||
      String(action.key ?? "").toLowerCase().includes(filter)
    )
  })
  const domain = (manifest.domain ?? {}) as any
  ctx.stdout.write(
    pretty({
      ok: true,
      baseUrl: session.baseUrl,
      appId: manifest.instant.appId ?? session.appId,
      entities: domain.entities ?? [],
      links: domain.links ?? [],
      rooms: domain.rooms ?? [],
      actions,
      contextString: manifest.contextString ?? null,
    }),
  )
}

async function commandQuery(args: string[], ctx: CliContext) {
  const { positionals, flags } = parseFlags(args)
  const session = await resolveSession(flags)
  if (!session.appId || !session.refreshToken) {
    throw new Error("No saved client session. Run login first.")
  }
  const query = parseJsonInput(positionals[0], "query")
  const manifest = await fetchDomainManifest({
    baseUrl: session.baseUrl,
    refreshToken: session.refreshToken,
  })
  const runtime = new ClientRuntime({
    appId: session.appId,
    refreshToken: session.refreshToken,
    apiURI: session.apiURI,
  })
  const result = await runtime.query(query, manifest.schema)
  const output =
    result && typeof result === "object" && "data" in (result as any)
      ? (result as any).data
      : result
  ctx.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

async function commandAction(actionName: string, args: string[], ctx: CliContext) {
  const { positionals, flags } = parseFlags(args)
  const session = await resolveSession(flags)
  if (!session.baseUrl || !session.refreshToken) {
    throw new Error("No saved session. Run login first.")
  }
  const input = parseJsonInput(positionals[0], "action input")
  const envFlag = flagValue(flags, ["env"])
  const env =
    typeof envFlag === "string" && envFlag.trim()
      ? (parseJsonInput(envFlag, "env") as Record<string, unknown>)
      : undefined
  const manifest = await fetchDomainManifest({
    baseUrl: session.baseUrl,
    refreshToken: session.refreshToken,
  })
  const resolvedActionName =
    manifest.actions.find(
      (entry) => entry.name === actionName || String(entry.key ?? "") === actionName,
    )?.name ?? actionName
  const result = await postDomainAction({
    baseUrl: session.baseUrl,
    appId: session.appId,
    refreshToken: session.refreshToken,
    action: resolvedActionName,
    input,
    env,
  })
  ctx.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

async function commandLogout(ctx: CliContext) {
  await clearCliSession()
  ctx.stdout.write(pretty({ ok: true }))
}

export async function runCli(argv: string[], ctx: CliContext = { stdout: output, stderr: output }) {
  const [command, ...rest] = argv

  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      printHelp(ctx)
      return 0
    }

    if (command === "login") {
      await commandLogin(rest, ctx)
      return 0
    }
    if (command === "inspect") {
      await commandInspect(rest, ctx)
      return 0
    }
    if (command === "query") {
      await commandQuery(rest, ctx)
      return 0
    }
    if (command === "action") {
      const [actionName, ...args] = rest
      if (!actionName) throw new Error("action name is required")
      await commandAction(actionName, args, ctx)
      return 0
    }
    if (command === "logout") {
      await commandLogout(ctx)
      return 0
    }

    await commandAction(command, rest, ctx)
    return 0
  } catch (error) {
    ctx.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

const isDirectExecution = (() => {
  const current = process.argv[1] ?? ""
  return current.endsWith("bin.js") || current.endsWith("bin.ts")
})()

if (isDirectExecution) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}

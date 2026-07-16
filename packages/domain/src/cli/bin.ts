#!/usr/bin/env node
import { fileURLToPath } from "node:url"
import { stdin as input, stdout as output } from "node:process"
import readline from "node:readline/promises"
import { createDomainApp, normalizeCreateAppTemplate } from "./create-app.js"
import { runCreateAppInk } from "./ui.js"

const DOMAIN_SKILL_PATH = fileURLToPath(new URL("../../SKILL.md", import.meta.url))

type CliContext = {
  stdout: Pick<typeof output, "write">
  stderr: Pick<typeof output, "write">
}

function printHelp(ctx: CliContext) {
  ctx.stdout.write(
    [
      "ekairos domain",
      "",
      "This programmatic CLI is executed by @ekairos/cli.",
      `Skill: ${DOMAIN_SKILL_PATH}`,
      "",
      "Commands:",
      "  create-app [dir] --next [--install] [--instantToken=<token>]",
      "",
      "Domain operations (platform-mediated, requires ekairos login):",
      "  ekairos domain introspect --app=<appId> [--env=<key>]",
      "  ekairos domain query <json5|@file|-> --app=<appId> [--env=<key>]",
      "  ekairos domain action <name> <json5|@file|-> --app=<appId> [--env=<key>]",
      "  ekairos domain env register --app=<appId> --env=<key> --data='{...}'",
      "",
      "Scaffold flags:",
      "  Run `ekairos create-app --help` for create-app flags.",
      "",
    ].join("\n"),
  )
}

function printCreateAppHelp(ctx: CliContext) {
  ctx.stdout.write(
    [
      "ekairos create-app",
      "",
      `Skill: ${DOMAIN_SKILL_PATH}`,
      "",
      "Usage:",
      "  ekairos create-app [dir] --next [options]",
      "  ekairos create-app [dir] --framework=next [options]",
      "",
      "Interactive mode:",
      "  In a TTY, omit --next/--framework and the CLI asks which framework to use.",
      "",
      "Non-interactive mode:",
      "  Pass --json, --plain, or --no-ui explicitly.",
      "  Non-interactive runs must pass --next or --framework=next.",
      "",
      "Options:",
      "  --next, --framework=next       Scaffold a Next.js app",
      "  --template=<name>              Template: empty, supply-chain, or agent",
      "  --install / --no-install       Install dependencies after writing files",
      "  --package-manager=<name>       npm, pnpm, yarn, or bun",
      "  --instantToken=<token>         Provision an Instant app and write .env.local",
      "  --appId=<id>                   Reuse an existing Instant app",
      "  --adminToken=<token>           Reuse an existing Instant admin token",
      "  --orgId=<id>                   Provision under an Instant org",
      "  --workspace=<path>             Use a local Ekairos workspace package",
      "  --force                        Replace a non-empty target directory",
      "  --demo                         Run the full supply-chain demo cycle",
      "  --smoke                        Typecheck, start Next, seed, and query the app",
      "  --keep-server                  With --smoke, leave the review server running",
      "  --json                         Print stable JSON and disable the interactive UI",
      "  --print-secrets                Include secrets in JSON output; off by default",
      "",
    ].join("\n"),
  )
}

function parseFlags(argv: string[]) {
  const positionals: string[] = []
  const flags = new Map<string, string | boolean>()

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1))
      break
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }

    const raw = arg.slice(2)
    if (!raw) continue

    if (raw.startsWith("no-") && raw.length > 3) {
      flags.set(raw.slice(3), false)
      continue
    }

    const separator = raw.indexOf("=")
    if (separator >= 0) {
      const name = raw.slice(0, separator)
      const value = raw.slice(separator + 1)
      flags.set(name, value)
      continue
    }

    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      flags.set(raw, next)
      index += 1
      continue
    }

    flags.set(raw, true)
  }

  return { positionals, flags }
}

function flagValue(flags: Map<string, string | boolean>, names: string[]) {
  for (const name of names) {
    if (flags.has(name)) return flags.get(name)
  }
  return undefined
}

function hasFlag(flags: Map<string, string | boolean>, names: string[]) {
  const value = flagValue(flags, names)
  return value === true || value === "true"
}

function shouldUseInteractiveCli(
  flags: Map<string, string | boolean>,
  ctx: CliContext,
) {
  return (
    ctx.stdout === output &&
    ctx.stderr === output &&
    Boolean(input.isTTY) &&
    Boolean(output.isTTY) &&
    !hasFlag(flags, ["json", "plain", "no-ui"])
  )
}

function hasHelpArg(args: string[]) {
  return args.some((arg) => arg === "--help" || arg === "-h" || arg === "help")
}

function isExplicitNonInteractive(flags: Map<string, string | boolean>) {
  return hasFlag(flags, ["json", "plain", "no-ui", "demo"])
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeFramework(value: string): "next" | "" {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return ""
  if (["next", "nextjs", "next.js"].includes(normalized)) return "next"
  throw new Error(`Unsupported framework: ${value}. Supported framework: next.`)
}

function resolveFrameworkFlag(flags: Map<string, string | boolean>): "next" | "" {
  if (hasFlag(flags, ["next"])) return "next"
  const framework = asTrimmedString(flagValue(flags, ["framework"]))
  return normalizeFramework(framework)
}

async function promptCreateAppFramework(): Promise<"next"> {
  const rl = readline.createInterface({ input, output })
  try {
    const answer = await rl.question("Framework [Next.js]: ")
    const framework = normalizeFramework(String(answer ?? "").trim() || "next")
    if (framework !== "next") {
      throw new Error(`Unsupported framework: ${framework}`)
    }
    return "next"
  } finally {
    rl.close()
  }
}

function createAppOutputData(
  result: Awaited<ReturnType<typeof createDomainApp>>,
  flags: Map<string, string | boolean>,
) {
  if (hasFlag(flags, ["print-secrets", "printSecrets"])) return result
  const { adminToken: _adminToken, ...safeResult } = result
  return safeResult
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry))
  }
  if (!value || typeof value !== "object") {
    return value
  }

  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortJsonValue((value as Record<string, unknown>)[key])
  }
  return sorted
}

function toJsonText(value: unknown, flags?: Map<string, string | boolean>) {
  const pretty = hasFlag(flags ?? new Map(), ["pretty"])
  const normalized = sortJsonValue(value)
  return `${JSON.stringify(normalized, null, pretty ? 2 : 0)}\n`
}

function writeJson(
  stream: Pick<typeof output, "write">,
  value: unknown,
  flags?: Map<string, string | boolean>,
) {
  stream.write(toJsonText(value, flags))
}

async function flushCliOutput(stream: Pick<typeof output, "write">) {
  if (stream !== output) return
  await new Promise<void>((resolveFlush) => {
    output.write("", () => resolveFlush())
  })
}

async function commandCreateApp(args: string[], ctx: CliContext) {
  if (hasHelpArg(args)) {
    printCreateAppHelp(ctx)
    return
  }

  const { positionals, flags } = parseFlags(args)
  const interactive = shouldUseInteractiveCli(flags, ctx)
  const demo = hasFlag(flags, ["demo"])
  if (!interactive && !isExplicitNonInteractive(flags)) {
    throw new Error(
      "create-app non-interactive mode is explicit. Pass --json, --plain, or --no-ui.",
    )
  }

  let framework = resolveFrameworkFlag(flags)
  if (!framework && demo) {
    framework = "next"
  }
  if (!framework && interactive) {
    framework = await promptCreateAppFramework()
  }
  if (!framework) {
    throw new Error("framework is required. Pass --next or --framework=next.")
  }

  const directory =
    String(positionals[0] ?? (demo ? "ekairos-supply-chain-demo" : ".")).trim() ||
    (demo ? "ekairos-supply-chain-demo" : ".")
  const template = normalizeCreateAppTemplate(flagValue(flags, ["template"]))
  const install = flagValue(flags, ["install"]) !== false
  const keptServers: Array<() => void> = []

  const params = {
    directory,
    framework,
    install,
    template: template ?? undefined,
    demo,
    force: hasFlag(flags, ["force"]),
    packageManager:
      asTrimmedString(flagValue(flags, ["packageManager", "package-manager"])) ||
      (demo ? "pnpm" : ""),
    workspacePath: asTrimmedString(flagValue(flags, ["workspace"])),
    instantToken:
      asTrimmedString(flagValue(flags, ["instantToken", "instant-token"])) ||
      asTrimmedString(process.env.INSTANT_PERSONAL_ACCESS_TOKEN) ||
      asTrimmedString(process.env.INSTANTDB_PERSONAL_ACCESS_TOKEN) ||
      asTrimmedString(process.env.INSTANT_PLATFORM_ACCESS_TOKEN),
    orgId: asTrimmedString(flagValue(flags, ["orgId", "org-id"])),
    appId: asTrimmedString(flagValue(flags, ["appId", "app-id"])),
    adminToken: asTrimmedString(flagValue(flags, ["adminToken", "admin-token"])),
    smoke: demo || hasFlag(flags, ["smoke"]),
    keepServer: demo || hasFlag(flags, ["keep-server", "keepServer"]),
    onKeepServer(server: { unref: () => void }) {
      keptServers.push(server.unref)
    },
  } as const

  const result = interactive
    ? await runCreateAppInk(params)
    : await createDomainApp(params)

  if (interactive) {
    for (const unref of keptServers) unref()
    return
  }

  writeJson(
    ctx.stdout,
    {
      ok: true,
      command: "create-app",
      data: createAppOutputData(result, flags),
    },
    flags,
  )
  await flushCliOutput(ctx.stdout)
  for (const unref of keptServers) unref()
}

export async function runCli(
  argv: string[],
  ctx: CliContext = { stdout: output, stderr: output },
) {
  const [command, ...rest] = argv

  try {
    if (!command || command === "--help" || command === "-h") {
      printHelp(ctx)
      return 0
    }
    if (command === "help") {
      if (rest[0] === "create-app") printCreateAppHelp(ctx)
      else printHelp(ctx)
      return 0
    }

    if (command === "create-app") {
      await commandCreateApp(rest, ctx)
      return 0
    }

    throw new Error(
      `Unknown command: ${command}. Domain operations run platform-mediated via @ekairos/cli: ekairos domain ${command} ... --app=<appId>. Run ekairos login first.`,
    )
  } catch (error) {
    writeJson(
      ctx.stderr,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      new Map(),
    )
    return 1
  }
}

const isDirectExecution = (() => {
  const current = process.argv[1] ?? ""
  return (
    current.endsWith("bin.js") ||
    current.endsWith("bin.ts")
  )
})()

if (isDirectExecution) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}

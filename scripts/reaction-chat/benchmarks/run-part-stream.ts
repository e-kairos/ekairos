import { spawn } from "node:child_process"
import { resolve } from "node:path"

import { config as dotenvConfig } from "dotenv"

import {
  PartStreamBenchmarkRuntime,
  runPartStreamBenchmark,
} from "../../../packages/reactor/examples/reaction-part-stream.benchmark.fixture.ts"

dotenvConfig({ path: resolve(process.cwd(), ".env.local"), quiet: true })

function positiveInteger(name: string, fallback: number) {
  const raw = String(process.env[name] ?? "").trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name}_positive_integer_required`)
  return value
}

async function command(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  const pnpmEntry = String(process.env.npm_execpath ?? "").trim()
  if (!pnpmEntry) throw new Error("pnpm_execpath_required")
  return await new Promise<{ stdout: string; stderr: string }>((resolveRun, reject) => {
    const child = spawn(process.execPath, [pnpmEntry, ...args], {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk })
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk })
    child.once("error", reject)
    child.once("close", code => {
      if (code !== 0) {
        reject(new Error(`command_failed:${code}:${stderr || stdout}`))
        return
      }
      resolveRun({ stdout, stderr })
    })
  })
}

function parseCreatedApp(output: string) {
  const appId = output.match(/"appId"\s*:\s*"([^"]+)"/)?.[1]
  const adminToken = output.match(/"adminToken"\s*:\s*"([^"]+)"/)?.[1]
  if (!appId || !adminToken) throw new Error("instant_cli_created_app_output_invalid")
  return { appId, adminToken }
}

async function provisionBenchmarkApp() {
  const title = `reaction-part-stream-benchmark-${Date.now()}`
  const created = await command([
    "exec",
    "instant-cli",
    "-y",
    "init-without-files",
    "--title",
    title,
  ])
  const app = parseCreatedApp(`${created.stdout}\n${created.stderr}`)
  const schemaPath = resolve("scripts/reaction-chat/benchmarks/instant.schema.ts")
  await command([
    "exec",
    "instant-cli",
    "-y",
    "push",
    "schema",
    "--app",
    app.appId,
  ], {
    ...process.env,
    INSTANT_APP_ADMIN_TOKEN: app.adminToken,
    INSTANT_SCHEMA_FILE_PATH: schemaPath,
  }, resolve("packages/reactor"))
  return app
}

async function destroyBenchmarkApp(appId: string) {
  await command([
    "exec",
    "instant-cli",
    "-y",
    "app",
    "delete",
    "--app",
    appId,
  ])
}

async function runCase(input: {
  runtime: PartStreamBenchmarkRuntime
  contextKey: string
  message: string
}) {
  const config = JSON.parse(input.message)
  const event = await runPartStreamBenchmark({
    runtime: input.runtime,
    contextKey: input.contextKey,
    config,
  })
  return { event }
}

async function main() {
  const parts = positiveInteger("REACTION_PART_BENCHMARK_PARTS", 100)
  const chunksPerPart = positiveInteger("REACTION_PART_BENCHMARK_CHUNKS", 16)
  const chunkBytes = positiveInteger("REACTION_PART_BENCHMARK_CHUNK_BYTES", 32)
  const app = await provisionBenchmarkApp()
  const runtime = new PartStreamBenchmarkRuntime(app)

  try {
    await runCase({
      runtime,
      contextKey: `part-stream:warmup:${Date.now()}`,
      message: JSON.stringify({ mode: "per-part", parts: 2, chunksPerPart: 2, chunkBytes }),
    })
    const reports = []
    for (const mode of ["shared", "per-part"] as const) {
      const result = await runCase({
        runtime,
        contextKey: `part-stream:${mode}:${Date.now()}`,
        message: JSON.stringify({ mode, parts, chunksPerPart, chunkBytes }),
      })
      reports.push(result.event.payload)
    }
    process.stdout.write(`${JSON.stringify({
      benchmark: "reaction-part-stream",
      appId: app.appId,
      reports,
    }, null, 2)}\n`)
  } finally {
    await destroyBenchmarkApp(app.appId)
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})

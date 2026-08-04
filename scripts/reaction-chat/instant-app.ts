import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))

export type ReactionChatInstantApp = Readonly<{
  appId: string
  adminToken: string
  title: string
}>

async function runPnpm(
  args: readonly string[],
  options: Readonly<{
    cwd?: string
    env?: NodeJS.ProcessEnv
  }> = {},
): Promise<string> {
  const pnpmEntry = String(process.env.npm_execpath ?? "").trim()
  if (!pnpmEntry) throw new Error("reaction_chat_requires_pnpm")

  return await new Promise<string>((resolveRun, reject) => {
    const child = spawn(process.execPath, [pnpmEntry, ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk })
    child.stderr.setEncoding("utf8").on("data", chunk => { output += chunk })
    child.once("error", reject)
    child.once("close", code => {
      if (code !== 0) {
        reject(new Error(`reaction_chat_instant_command_failed:${code}`))
        return
      }
      resolveRun(output)
    })
  })
}

function parseCreatedApp(output: string, title: string): ReactionChatInstantApp {
  const appId = output.match(/"appId"\s*:\s*"([^"]+)"/)?.[1]
  const adminToken = output.match(/"adminToken"\s*:\s*"([^"]+)"/)?.[1]
  if (!appId || !adminToken) throw new Error("reaction_chat_instant_create_output_invalid")
  return Object.freeze({ appId, adminToken, title })
}

export async function createReactionChatInstantApp(): Promise<ReactionChatInstantApp> {
  const root = resolve(scriptDirectory, "../..")
  const title = `reaction-chat-${Date.now()}`
  const created = await runPnpm([
    "exec",
    "instant-cli",
    "-y",
    "init-without-files",
    "--title",
    title,
  ], { cwd: root })
  const app = parseCreatedApp(created, title)

  await runPnpm([
    "exec",
    "instant-cli",
    "-y",
    "push",
    "schema",
    "--app",
    app.appId,
  ], {
    cwd: resolve(root, "packages/reactor"),
    env: {
      ...process.env,
      INSTANT_APP_ADMIN_TOKEN: app.adminToken,
      INSTANT_SCHEMA_FILE_PATH: resolve(scriptDirectory, "instant.schema.ts"),
    },
  })

  return app
}

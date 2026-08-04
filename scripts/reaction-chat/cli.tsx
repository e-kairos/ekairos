import React from "react"
import { render } from "ink"

import {
  createSessionLogDb,
  logSession,
} from "../../packages/events/src/index.ts"
import { parseCliArgs, type CliOptions } from "./args.ts"
import { createReactionChatInstantApp } from "./instant-app.ts"
import { ReactionInspector } from "./reaction-inspector.tsx"
import {
  completeReactionTurn,
  eventText,
  startReactionTurn,
} from "./reaction-module.ts"

const HELP = `Usage:
  pnpm reaction:chat <reaction.ts> [--context <key>]
  pnpm reaction:chat <reaction.ts> --input <json> [--context <key>] [--json]

The module must export:
  export async function react({ input, contextKey }): Promise<SessionRun>

Interactive input is JSON.
Commands:
  /context <key>  switch context
  /new [key]      create a context key
  /exit           quit`

async function runJson(options: CliOptions): Promise<void> {
  if (options.input === undefined) throw new Error("--json requires --input <json>")
  const app = await createReactionChatInstantApp()
  process.env.REACTION_CHAT_INSTANT_APP_ID = app.appId
  process.env.REACTION_CHAT_INSTANT_ADMIN_TOKEN = app.adminToken
  process.stdout.write(`${JSON.stringify({
    kind: "instant.app",
    appId: app.appId,
    title: app.title,
  })}\n`)

  const started = await startReactionTurn({
    modulePath: options.modulePath,
    contextKey: options.contextKey,
    input: options.input,
  })
  const db = createSessionLogDb(app)
  const logging = logSession({
    db,
    sessionId: started.run.sessionId,
    write(record) {
      process.stdout.write(`${JSON.stringify(record)}\n`)
    },
  })
  const [result] = await Promise.all([completeReactionTurn(started), logging])
  process.stdout.write(`${JSON.stringify({
    kind: "reaction.output",
    ok: true,
    contextKey: options.contextKey,
    contextId: result.contextId,
    sessionId: result.sessionId,
    elapsedMs: result.elapsedMs,
    event: result.event,
    text: eventText(result.event),
  })}\n`)
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${HELP}\n`)
    return
  }
  const options = parseCliArgs(args)
  if (options.json) {
    await runJson(options)
    return
  }
  const instance = render(<ReactionInspector options={options} />)
  await instance.waitUntilExit()
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`reaction-chat: ${message}\n\n${HELP}\n`)
  process.exitCode = 1
})

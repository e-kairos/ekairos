import { basename } from "node:path"

export type CliOptions = Readonly<{
  modulePath: string
  contextKey: string
  input?: unknown
  json: boolean
}>

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`)
  return value
}

export function parseCliArgs(args: readonly string[]): CliOptions {
  let modulePath = ""
  let contextKey = ""
  let input: unknown
  let hasInput = false
  let json = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--context") {
      contextKey = requiredValue(args, index, argument)
      index += 1
      continue
    }
    if (argument === "--input") {
      const serialized = requiredValue(args, index, argument)
      try {
        input = JSON.parse(serialized)
      } catch {
        throw new Error("--input requires valid JSON")
      }
      hasInput = true
      index += 1
      continue
    }
    if (argument === "--json") {
      json = true
      continue
    }
    if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`)
    if (modulePath) throw new Error(`Unexpected argument: ${argument}`)
    modulePath = argument
  }

  if (!modulePath) throw new Error("A reaction .ts module is required")
  const defaultName = basename(modulePath).replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-")

  return Object.freeze({
    modulePath,
    contextKey: contextKey || `reaction-chat:${defaultName}`,
    ...(hasInput ? { input } : {}),
    json,
  })
}

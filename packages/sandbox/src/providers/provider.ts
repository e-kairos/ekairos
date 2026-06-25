import type { SandboxConfig, SandboxProvider } from "../types.js"

export function resolveProvider(config: SandboxConfig): SandboxProvider {
  const explicitValue =
    typeof config.provider === "object" && config.provider !== null
      ? config.provider.kind
      : config.provider
  const explicit = String(explicitValue ?? "").trim().toLowerCase()
  if (explicit === "daytona") return "daytona"
  if (explicit === "vercel") return "vercel"
  if (explicit === "sprites") return "sprites"
  if (explicit === "local") return "local"
  if (explicit === "justbash") return "justbash"
  if (explicit === "agentos") return "agentos"

  const env = String(process.env.SANDBOX_PROVIDER ?? "").trim().toLowerCase()
  if (env === "daytona") return "daytona"
  if (env === "vercel") return "vercel"
  if (env === "sprites") return "sprites"
  if (env === "local") return "local"
  if (env === "justbash") return "justbash"
  if (env === "agentos") return "agentos"

  return "sprites"
}

import { resolve } from "node:path"

import { config as dotenvConfig } from "dotenv"

const envRoots = [
  process.cwd(),
  resolve(process.cwd(), ".."),
  resolve(process.cwd(), "..", ".."),
  resolve(process.cwd(), "..", "..", ".."),
  resolve(process.cwd(), "..", "..", "..", "ekairos-core"),
]

for (const root of envRoots) {
  dotenvConfig({ path: resolve(root, ".env.local"), quiet: true })
  dotenvConfig({ path: resolve(root, ".env"), quiet: true })
}

export function hasVar(name: string): boolean {
  return Boolean(String(process.env[name] ?? "").trim())
}

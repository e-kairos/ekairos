import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import os from "node:os"

import type { DomainCliSession } from "./types.js"

function resolveCliHome() {
  const explicit = String(process.env.EKAIROS_DOMAIN_CLI_HOME ?? "").trim()
  if (explicit) return resolve(explicit)
  return resolve(os.homedir(), ".ekairos")
}

function resolveCliConfigPath() {
  return resolve(resolveCliHome(), "domain-cli.json")
}

export async function readCliSession(): Promise<DomainCliSession | null> {
  try {
    const raw = await readFile(resolveCliConfigPath(), "utf8")
    const parsed = JSON.parse(raw) as DomainCliSession
    if (!parsed || typeof parsed !== "object") return null
    if (parsed.version !== 1) return null
    if (!parsed.baseUrl || !parsed.appId || !parsed.refreshToken) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeCliSession(session: DomainCliSession): Promise<void> {
  const target = resolveCliConfigPath()
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(session, null, 2), "utf8")
}

export async function clearCliSession(): Promise<void> {
  await writeCliSession({
    version: 1,
    baseUrl: "",
    appId: "",
    refreshToken: "",
    apiURI: "https://api.instantdb.com",
    savedAt: new Date(0).toISOString(),
  })
}

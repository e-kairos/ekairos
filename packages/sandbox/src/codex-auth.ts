import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { posix } from "node:path"

import type { SandboxSession } from "./session.js"

export type CodexSandboxAuthSource = {
  codexHome?: string
  authJsonPath?: string
  credentialsJsonPath?: string
  configTomlPath?: string
}

export type CodexSandboxAuthInstallResult = {
  codexHome: string
  authJson: boolean
  credentialsJson: boolean
  configToml: boolean
  files: string[]
}

function isPosixPath(value: string) {
  return value.startsWith("/")
}

function joinSandboxPath(root: string, ...segments: string[]) {
  return isPosixPath(root)
    ? posix.join(root, ...segments)
    : path.join(root, ...segments)
}

function normalizeCodexHome(session: SandboxSession, value: string | undefined) {
  const configured = String(value ?? "").trim()
  if (configured) return configured.replace(/[\\/]+$/, "")
  return joinSandboxPath(session.workspaceRoot, ".codex")
}

function localCodexHome() {
  return String(process.env.CODEX_HOME ?? "").trim() || path.join(homedir(), ".codex")
}

async function optionalFile(sourcePath: string, targetPath: string) {
  if (!existsSync(sourcePath)) return null
  return {
    path: targetPath,
    content: await readFile(sourcePath),
  }
}

export async function installCodexAuthToSandboxSession(
  session: SandboxSession,
  source: CodexSandboxAuthSource = {},
): Promise<CodexSandboxAuthInstallResult> {
  const codexHome = normalizeCodexHome(session, source.codexHome)
  const localHome = localCodexHome()
  const sources = {
    authJson: String(source.authJsonPath ?? "").trim() || path.join(localHome, "auth.json"),
    credentialsJson:
      String(source.credentialsJsonPath ?? "").trim() || path.join(localHome, ".credentials.json"),
    configToml: String(source.configTomlPath ?? "").trim() || path.join(localHome, "config.toml"),
  }

  // Test-only credential transfer: Codex engines must run inside a sandbox, and
  // local auth copying is only intended for controlled development sandboxes.
  const authJson = await optionalFile(sources.authJson, joinSandboxPath(codexHome, "auth.json"))
  const credentialsJson = await optionalFile(
    sources.credentialsJson,
    joinSandboxPath(codexHome, ".credentials.json"),
  )
  const configToml = await optionalFile(sources.configToml, joinSandboxPath(codexHome, "config.toml"))
  const files = [authJson, credentialsJson, configToml].filter((file) => file !== null)

  if (!authJson && !credentialsJson) {
    throw new Error("codex_auth_file_not_found")
  }

  await session.writeFiles(files)

  return {
    codexHome,
    authJson: Boolean(authJson),
    credentialsJson: Boolean(credentialsJson),
    configToml: Boolean(configToml),
    files: files.map((file) => file.path),
  }
}

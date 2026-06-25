import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  createSandboxSession,
  installCodexAuthToSandboxSession,
  localSandbox,
} from "../index"

describe("Codex sandbox auth", () => {
  it("copies local Codex auth files into a sandbox session", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ekairos-codex-auth-sandbox-"))
    const localCodexHome = await mkdtemp(join(tmpdir(), "ekairos-codex-auth-source-"))
    const session = await createSandboxSession(
      localSandbox({
        basePath: workspaceRoot,
        cleanup: true,
      }),
    )

    try {
      const authJsonPath = join(localCodexHome, "auth.json")
      const credentialsJsonPath = join(localCodexHome, ".credentials.json")
      const configTomlPath = join(localCodexHome, "config.toml")
      await writeFile(authJsonPath, JSON.stringify({ token: "test-auth" }))
      await writeFile(credentialsJsonPath, JSON.stringify({ token: "test-credentials" }))
      await writeFile(configTomlPath, "model = \"test\"\n")

      const codexHome = join(workspaceRoot, "remote-codex-home")
      const result = await installCodexAuthToSandboxSession(session, {
        codexHome,
        authJsonPath,
        credentialsJsonPath,
        configTomlPath,
      })

      expect(result).toMatchObject({
        codexHome,
        authJson: true,
        credentialsJson: true,
        configToml: true,
      })
      await expect(readFile(join(codexHome, "auth.json"), "utf8")).resolves.toContain(
        "test-auth",
      )
      await expect(readFile(join(codexHome, ".credentials.json"), "utf8")).resolves.toContain(
        "test-credentials",
      )
      await expect(readFile(join(codexHome, "config.toml"), "utf8")).resolves.toContain(
        "model",
      )
    } finally {
      await session.stop()
      await rm(workspaceRoot, { recursive: true, force: true })
      await rm(localCodexHome, { recursive: true, force: true })
    }
  })

  it("fails when neither auth.json nor .credentials.json exists", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ekairos-codex-auth-empty-"))
    const localCodexHome = await mkdtemp(join(tmpdir(), "ekairos-codex-auth-missing-"))
    const session = await createSandboxSession(
      localSandbox({
        basePath: workspaceRoot,
        cleanup: true,
      }),
    )

    try {
      await expect(
        installCodexAuthToSandboxSession(session, {
          codexHome: join(workspaceRoot, "remote-codex-home"),
          authJsonPath: join(localCodexHome, "auth.json"),
          credentialsJsonPath: join(localCodexHome, ".credentials.json"),
        }),
      ).rejects.toThrow("codex_auth_file_not_found")
    } finally {
      await session.stop()
      await rm(workspaceRoot, { recursive: true, force: true })
      await rm(localCodexHome, { recursive: true, force: true })
    }
  })
})

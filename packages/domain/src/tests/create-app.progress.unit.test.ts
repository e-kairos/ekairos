/* @vitest-environment node */

import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createDomainApp,
  type CreateDomainAppProgressEvent,
} from "../cli/create-app.js"
import { runCli } from "../cli/index.js"

const tempDirs: string[] = []

function createIo() {
  let stdout = ""
  let stderr = ""
  return {
    io: {
      stdout: {
        write(chunk: string) {
          stdout += chunk
          return true
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk
          return true
        },
      },
    },
    read: () => ({ stdout, stderr }),
  }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe("create-app progress", () => {
  it("emits progress events and writes the scaffold without install", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "ek-domain-create-app-"))
    tempDirs.push(targetDir)

    const events: CreateDomainAppProgressEvent[] = []
    const result = await createDomainApp({
      directory: targetDir,
      framework: "next",
      install: false,
      packageManager: "pnpm",
      onProgress(event) {
        events.push(event)
      },
    })

    expect(result.ok).toBe(true)
    expect(result.installed).toBe(false)
    expect(result.adminTokenWritten).toBe(false)
    expect(result.envFile).toBeNull()
    expect(result.smoke).toBeNull()
    expect(events.some((event) => event.stage === "prepare-target" && event.status === "running")).toBe(true)
    expect(events.some((event) => event.stage === "write-files" && event.status === "completed")).toBe(true)
    expect(events.some((event) => event.stage === "complete" && event.status === "completed" && event.progress === 100)).toBe(true)

    const packageJson = await readFile(join(targetDir, "package.json"), "utf8")
    const domainFile = await readFile(join(targetDir, "src", "domain.ts"), "utf8")
    const showcaseFile = await readFile(join(targetDir, "src", "app", "domain-showcase.tsx"), "utf8")
    const runtimeFile = await readFile(join(targetDir, "src", "runtime.ts"), "utf8")
    const routeFile = await readFile(
      join(targetDir, "src", "app", "api", "ekairos", "domain", "route.ts"),
      "utf8",
    )

    expect(packageJson).toContain('"next"')
    expect(packageJson).toContain('"@instantdb/react"')
    expect(packageJson).toContain('"workflow": "^5.0.0-beta.1"')
    expect(packageJson).not.toContain("@workflow/world-local")
    expect(domainFile).toContain("supplierNetwork_supplier")
    expect(domainFile).toContain("supplyChain.order.launch")
    expect(showcaseFile).toContain("@instantdb/react")
    expect(showcaseFile).toContain("control tower")
    expect(runtimeFile).toContain("export class AppRuntime")
    expect(runtimeFile).toContain("@ekairos/domain/runtime-handle")
    expect(routeFile).toContain("createRuntimeRouteHandler")
    expect(routeFile).toContain('from "@/runtime"')
    expect(routeFile).not.toContain("@ekairos/thread")
    expect(routeFile).not.toContain(".well-known")
  })

  it("documents create-app flags through command help", async () => {
    const io = createIo()
    const code = await runCli(["create-app", "--help"], io.io as any)

    expect(code).toBe(0)
    expect(io.read().stdout).toContain("Non-interactive mode")
    expect(io.read().stdout).toContain("--smoke")
    expect(io.read().stdout).toContain("--keep-server")
    expect(io.read().stdout).toContain("--print-secrets")
  })

  it("requires explicit non-interactive create-app mode", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "ek-domain-create-app-"))
    tempDirs.push(targetDir)

    const io = createIo()
    const code = await runCli(
      ["create-app", targetDir, "--next", "--no-install", "--package-manager=pnpm"],
      io.io as any,
    )

    expect(code).toBe(1)
    expect(io.read().stderr).toContain("non-interactive mode is explicit")
  })

  it("does not print admin tokens in non-interactive output by default", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "ek-domain-create-app-"))
    tempDirs.push(targetDir)

    const io = createIo()
    const code = await runCli(
      [
        "create-app",
        targetDir,
        "--next",
        "--no-install",
        "--package-manager=pnpm",
        "--appId=app_public",
        "--adminToken=secret_admin_token",
        "--json",
      ],
      io.io as any,
    )

    expect(code, io.read().stderr).toBe(0)
    const payload = JSON.parse(io.read().stdout)
    expect(payload.ok).toBe(true)
    expect(payload.data.appId).toBe("app_public")
    expect(payload.data.adminToken).toBeUndefined()
    expect(payload.data.adminTokenWritten).toBe(true)
    expect(payload.data.envFile).toContain(".env.local")
    expect(io.read().stdout).not.toContain("secret_admin_token")
  })
})

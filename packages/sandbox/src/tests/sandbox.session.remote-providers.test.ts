import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createDaytona: vi.fn(),
  stopDaytona: vi.fn(),
  provisionSprites: vi.fn(),
  provisionVercel: vi.fn(),
  spritesExec: vi.fn(),
}))

vi.mock("@daytonaio/sdk", () => ({
  Daytona: class {
    create = mocks.createDaytona
    stop = mocks.stopDaytona
  },
}))

vi.mock("../providers/daytona.js", () => ({
  buildDeclarativeImage: vi.fn(() => undefined),
  getDaytonaConfig: vi.fn(() => ({})),
  resolveDaytonaLanguage: vi.fn(() => "typescript"),
  resolveDaytonaVolumes: vi.fn(async () => []),
}))

vi.mock("../providers/vercel.js", () => ({
  provisionVercelSandbox: mocks.provisionVercel,
}))

vi.mock("../providers/sprites.js", () => ({
  provisionSpritesSandbox: mocks.provisionSprites,
  spritesExec: mocks.spritesExec,
}))

import {
  createSandboxSession,
  daytonaSandbox,
  spritesSandbox,
  vercelSandbox,
} from "../session"

describe("remote sandbox session filesystem existence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("uses Vercel's command API to distinguish present, missing, and failed probes", async () => {
    const runCommand = vi.fn(async (input: { cmd: string; args?: string[] }) => ({
      exitCode:
        input.args?.[1] === "/vercel/sandbox/present.txt"
          ? 0
          : input.args?.[1] === "/vercel/sandbox/missing.txt"
            ? 1
            : 2,
    }))
    mocks.provisionVercel.mockResolvedValue({
      name: "vercel-test",
      mkDir: vi.fn(async () => undefined),
      runCommand,
      writeFiles: vi.fn(async () => undefined),
      readFile: vi.fn(async () => null),
      stop: vi.fn(async () => undefined),
      domain: vi.fn(() => "https://example.test"),
    })

    const session = await createSandboxSession(vercelSandbox())

    await expect(session.exists("/vercel/sandbox/present.txt")).resolves.toBe(true)
    await expect(session.exists("/vercel/sandbox/missing.txt")).resolves.toBe(false)
    await expect(session.exists("/vercel/sandbox/probe-error.txt")).rejects.toThrow(
      "vercel_exists_failed",
    )
    expect(runCommand).toHaveBeenCalledWith({
      cmd: "test",
      args: ["-e", "/vercel/sandbox/present.txt"],
    })
  })

  it("uses Daytona file metadata and only converts a native 404 to false", async () => {
    const getFileDetails = vi.fn(async (path: string) => {
      if (path === "/home/daytona/present.txt") {
        return { name: "present.txt", size: 7 }
      }
      if (path === "/home/daytona/missing.txt") {
        throw Object.assign(new Error("not found"), { statusCode: 404 })
      }
      throw Object.assign(new Error("provider unavailable"), { statusCode: 503 })
    })
    mocks.createDaytona.mockResolvedValue({
      id: "daytona-test",
      fs: {
        getFileDetails,
        uploadFiles: vi.fn(async () => undefined),
        downloadFile: vi.fn(async () => Buffer.alloc(0)),
      },
      process: {
        executeCommand: vi.fn(async () => ({ exitCode: 0, result: "" })),
      },
    })

    const session = await createSandboxSession(daytonaSandbox())

    await expect(session.exists("/home/daytona/present.txt")).resolves.toBe(true)
    await expect(session.exists("/home/daytona/missing.txt")).resolves.toBe(false)
    await expect(session.exists("/home/daytona/provider-error.txt")).rejects.toThrow(
      "provider unavailable",
    )
  })

  it("forwards Daytona command path, environment, and timeout", async () => {
    const executeCommand = vi.fn(async () => ({ exitCode: 0, result: "ok" }))
    mocks.createDaytona.mockResolvedValue({
      id: "daytona-test",
      fs: {
        getFileDetails: vi.fn(async () => ({})),
        uploadFiles: vi.fn(async () => undefined),
        downloadFile: vi.fn(async () => Buffer.alloc(0)),
      },
      process: { executeCommand },
    })

    const session = await createSandboxSession(daytonaSandbox())

    await expect(
      session.exec({
        command: "node",
        args: ["script.js", "hello world"],
        cwd: "/home/daytona/contexts/context-1/repositories/platform/checkout",
        env: { EKAIROS_CONTEXT: "/home/daytona/contexts/context-1" },
        timeoutMs: 1_001,
      }),
    ).resolves.toMatchObject({ exitCode: 0, output: "ok" })
    expect(executeCommand).toHaveBeenCalledWith(
      "EKAIROS_CONTEXT='/home/daytona/contexts/context-1'; export EKAIROS_CONTEXT; node script.js 'hello world'",
      "/home/daytona/contexts/context-1/repositories/platform/checkout",
      undefined,
      2,
    )
  })

  it("uses Sprites' exec API to distinguish present, missing, and failed probes", async () => {
    mocks.provisionSprites.mockResolvedValue({
      __provider: "sprites",
      name: "sprite-test",
    })
    mocks.spritesExec.mockImplementation(async (input: { command: string; args?: string[] }) => ({
      exitCode:
        input.args?.[1] === "/workspace/present.txt"
          ? 0
          : input.args?.[1] === "/workspace/missing.txt"
            ? 1
            : 2,
      stdout: "",
      stderr: "",
    }))

    const session = await createSandboxSession(spritesSandbox())

    await expect(session.exists("/workspace/present.txt")).resolves.toBe(true)
    await expect(session.exists("/workspace/missing.txt")).resolves.toBe(false)
    await expect(session.exists("/workspace/probe-error.txt")).rejects.toThrow(
      "sprites_exists_failed",
    )
    expect(mocks.spritesExec).toHaveBeenCalledWith({
      spriteName: "sprite-test",
      command: "test",
      args: ["-e", "/workspace/present.txt"],
    })
  })
})

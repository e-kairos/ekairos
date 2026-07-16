/* @vitest-environment node */

import { describe, expect, it } from "vitest"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"

import { Sandbox } from "../sandbox"
import { sandboxDomain } from "../actions"
import { SandboxCommandRun, SandboxService } from "../service"
import { SandboxWorkflowTestRuntime } from "./sandbox.workflow-fixtures"

describe("sandbox workflow-safe boundary", () => {
  const env = {
    appId: "00000000-0000-0000-0000-000000000000",
    adminToken: "test-admin-token",
    marker: "unit",
  }

  it("serializes the domain runtime instead of SandboxService", () => {
    const runtime = new SandboxWorkflowTestRuntime(env)
    const serialized = (SandboxWorkflowTestRuntime as any)[WORKFLOW_SERIALIZE](runtime)

    expect(serialized).toEqual({ env })

    const restored = (SandboxWorkflowTestRuntime as any)[WORKFLOW_DESERIALIZE](serialized)
    expect(restored).toBeInstanceOf(SandboxWorkflowTestRuntime)
    expect(restored.env).toEqual(env)
  })

  it("keeps node-backed service classes out of workflow serde", () => {
    expect((SandboxService as any)[WORKFLOW_SERIALIZE]).toBeUndefined()
    expect((SandboxService as any)[WORKFLOW_DESERIALIZE]).toBeUndefined()
    expect((SandboxCommandRun as any)[WORKFLOW_SERIALIZE]).toBeUndefined()
    expect((SandboxCommandRun as any)[WORKFLOW_DESERIALIZE]).toBeUndefined()
  })

  it("serializes a multiprovider sandbox handle with its runtime", () => {
    const runtime = new SandboxWorkflowTestRuntime(env)
    const sandbox = Sandbox.from(runtime, {
      version: 1,
      sandboxId: "sandbox_123",
      provider: "sprites",
      externalSandboxId: "sprite_123",
      runtime: "node22",
      ports: [3000],
      purpose: "unit-test",
    })

    const serialized = (Sandbox as any)[WORKFLOW_SERIALIZE](sandbox)

    expect(serialized).toEqual({
      runtime,
      state: {
        version: 1,
        sandboxId: "sandbox_123",
        provider: "sprites",
        externalSandboxId: "sprite_123",
        runtime: "node22",
        ports: [3000],
        purpose: "unit-test",
        workspaceRoot: "/workspace",
      },
    })

    const restored = (Sandbox as any)[WORKFLOW_DESERIALIZE](serialized)
    expect(restored).toBeInstanceOf(Sandbox)
    expect(restored.sandboxId).toBe("sandbox_123")
    expect(restored.workspaceRoot).toBe("/workspace")
    expect(restored.state).toEqual(serialized.state)
  })

  it("opens a durable sandbox by id without retaining a provider session", async () => {
    const queries: unknown[] = []
    const runtime = {
      env,
      meta: () => ({ domain: sandboxDomain }),
      use: async () => ({
        db: {
          query: async (query: unknown) => {
            queries.push(query)
            return {
              sandbox_sandboxes: [{
                id: "sandbox_123",
                provider: "vercel",
                externalSandboxId: "remote_123",
                runtime: "node22",
              }],
            }
          },
        },
        actions: {},
      }),
    }

    const sandbox = await Sandbox.open(runtime as any, "sandbox_123")

    expect(sandbox.id).toBe("sandbox_123")
    expect(sandbox.provider).toBe("vercel")
    expect(sandbox.workspaceRoot).toBe("/vercel/sandbox")
    expect(sandbox.state.externalSandboxId).toBe("remote_123")
    expect(queries).toHaveLength(1)
  })

  it("fails explicitly when a durable sandbox id does not exist", async () => {
    const runtime = {
      env,
      meta: () => ({ domain: sandboxDomain }),
      use: async () => ({
        db: { query: async () => ({ sandbox_sandboxes: [] }) },
        actions: {},
      }),
    }

    await expect(Sandbox.open(runtime as any, "missing"))
      .rejects.toThrow("sandbox_not_found:missing")
  })

  it("executes commands through the domain with sandboxId bound", async () => {
    const useCalls: unknown[] = []
    const commandCalls: unknown[] = []
    const runtime = {
      env,
      meta: () => ({ domain: sandboxDomain }),
      use: async (domain: unknown) => {
        useCalls.push(domain)
        return {
          actions: {
            runCommandProcess: async (input: unknown) => {
              commandCalls.push(input)
              return {
                ok: true,
                data: {
                  processId: "process_123",
                  streamId: "stream_123",
                  streamClientId: "sandbox-process:process_123",
                  result: {
                    success: true,
                    exitCode: 0,
                    output: "ok\n",
                    command: "pnpm test",
                  },
                },
              }
            },
          },
        }
      },
    }
    const sandbox = Sandbox.from(runtime as any, {
      version: 1,
      sandboxId: "sandbox_123",
      provider: "sprites",
    })

    const result = await sandbox.executeCommand({
      command: "pnpm",
      args: ["test"],
      cwd: "/workspace/app",
      metadata: { reason: "unit" },
    })

    expect(useCalls).toEqual([sandboxDomain])
    expect(commandCalls).toEqual([
      {
        sandboxId: "sandbox_123",
        command: "pnpm",
        args: ["test"],
        cwd: "/workspace/app",
        kind: "command",
        mode: "foreground",
        metadata: {
          source: "sandbox.handle",
          reason: "unit",
        },
      },
    ])
    expect(result).toEqual({
      sandboxId: "sandbox_123",
      processId: "process_123",
      streamId: "stream_123",
      streamClientId: "sandbox-process:process_123",
      success: true,
      exitCode: 0,
      output: "ok\n",
      command: "pnpm test",
      status: "exited",
    })
  })
})

import {
  DOMAIN_ACTION_FULL_INPUT_TYPE,
  DOMAIN_ACTION_OWNER_TYPE,
  DOMAIN_ACTION_RUNTIME_TYPE,
  defineAction,
} from "@ekairos/domain"
import { z } from "zod"

import type { CommandResult } from "./commands.js"
import {
  SANDBOX_PROCESS_KINDS,
  SANDBOX_PROCESS_MODES,
  sandboxCommandResultSchema,
  sandboxProcessRunResultSchema,
  sandboxProcessStreamChunkSchema,
} from "./contract.js"
import {
  appendObservedProcessChunkStep,
  createCheckpointStep,
  createEkairosAppStep,
  createSandboxStep,
  finishObservedProcessStep,
  getPortUrlStep,
  getSandboxStep,
  installCodexAuthStep,
  readFileStep,
  readProcessStreamStep,
  runCommandProcessStep,
  runCommandStep,
  startObservedProcessStep,
  stopSandboxStep,
  writeFilesStep,
} from "./action-steps.js"
import { sandboxSchemaDomain } from "./schema.js"
import {
  type SandboxProcessRunResult,
  type SandboxProcessStreamChunk,
} from "./service.js"
import type { SandboxConfig } from "./types.js"

const serviceError = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const serviceResult = <Schema extends z.ZodType>(data: Schema) =>
  z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      data,
    }),
    serviceError,
  ])

const serviceVoidResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.unknown().optional(),
  }),
  serviceError,
])

const commandResult = sandboxCommandResultSchema as z.ZodType<CommandResult>
const processStreamChunk =
  sandboxProcessStreamChunkSchema as z.ZodType<SandboxProcessStreamChunk>
const processRunResult = sandboxProcessRunResultSchema as z.ZodType<SandboxProcessRunResult>

function createSandboxDomain() {
  return sandboxSchemaDomain.withActions({
    createSandbox: defineAction({
      input: z.object({
        provider: z.enum(["vercel", "daytona", "sprites", "local"]).optional(),
        runtime: z.string().optional(),
        timeoutMs: z.number().optional(),
        ports: z.array(z.number()).optional(),
        resources: z.object({ vcpus: z.number().optional() }).passthrough().optional(),
        purpose: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
        env: z.record(z.string(), z.unknown()).optional(),
        domain: z.unknown().optional(),
        dataset: z.object({ enabled: z.boolean().optional() }).passthrough().optional(),
        skills: z.array(z.object({
          name: z.string(),
          description: z.string().optional(),
          files: z.array(z.object({
            path: z.string(),
            contentBase64: z.string(),
          })),
        })).optional(),
        vercel: z.record(z.string(), z.unknown()).optional(),
        daytona: z.record(z.string(), z.unknown()).optional(),
        sprites: z.record(z.string(), z.unknown()).optional(),
      }).passthrough() as z.ZodType<SandboxConfig>,
      output: serviceResult(z.object({ sandboxId: z.string() })),
      execute: createSandboxStep,
    }),
    stopSandbox: defineAction({
      input: z.object({ sandboxId: z.string() }),
      output: serviceVoidResult,
      execute: stopSandboxStep,
    }),
    runCommand: defineAction({
      input: z.object({
        sandboxId: z.string(),
        command: z.string(),
        args: z.array(z.string()).optional(),
      }),
      output: serviceResult(commandResult),
      execute: runCommandStep,
    }),
    runCommandProcess: defineAction({
      input: z.object({
        sandboxId: z.string(),
        command: z.string(),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional(),
        env: z.record(z.string(), z.unknown()).optional(),
        kind: z.enum(SANDBOX_PROCESS_KINDS).optional(),
        mode: z.enum(SANDBOX_PROCESS_MODES).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      output: serviceResult(processRunResult),
      execute: runCommandProcessStep,
    }),
    readProcessStream: defineAction({
      input: z.object({ processId: z.string() }),
      output: serviceResult(z.object({
        chunks: z.array(processStreamChunk),
        byteOffset: z.number(),
      })),
      execute: readProcessStreamStep,
    }),
    startObservedProcess: defineAction({
      input: z.object({
        sandboxId: z.string(),
        command: z.string(),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional(),
        env: z.record(z.string(), z.unknown()).optional(),
        kind: z.enum(SANDBOX_PROCESS_KINDS).optional(),
        mode: z.enum(SANDBOX_PROCESS_MODES).optional(),
        externalProcessId: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      output: serviceResult(processRunResult),
      execute: startObservedProcessStep,
    }),
    appendObservedProcessChunk: defineAction({
      input: z.object({
        processId: z.string(),
        type: z.enum(["stdout", "stderr", "status", "exit", "error", "heartbeat", "metadata"]),
        data: z.record(z.string(), z.unknown()).optional(),
      }),
      output: serviceVoidResult,
      execute: appendObservedProcessChunkStep,
    }),
    finishObservedProcess: defineAction({
      input: z.object({
        processId: z.string(),
        status: z.enum(["exited", "failed", "killed", "lost"]).optional(),
        exitCode: z.number().optional(),
        errorText: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      output: serviceVoidResult,
      execute: finishObservedProcessStep,
    }),
    writeFiles: defineAction({
      input: z.object({
        sandboxId: z.string(),
        files: z.array(z.object({
          path: z.string(),
          contentBase64: z.string(),
        })),
      }),
      output: serviceVoidResult,
      execute: writeFilesStep,
    }),
    readFile: defineAction({
      input: z.object({
        sandboxId: z.string(),
        path: z.string(),
      }),
      output: serviceResult(z.object({ contentBase64: z.string() })),
      execute: readFileStep,
    }),
    installCodexAuth: defineAction({
      input: z.object({
        sandboxId: z.string(),
        codexHome: z.string().optional(),
        authJsonPath: z.string().optional(),
        credentialsJsonPath: z.string().optional(),
        configTomlPath: z.string().optional(),
      }),
      output: serviceResult(z.object({
        authJson: z.boolean(),
        credentialsJson: z.boolean(),
        configToml: z.boolean(),
      })),
      execute: installCodexAuthStep,
    }),
    getSandbox: defineAction({
      input: z.object({ sandboxId: z.string() }),
      output: serviceResult(z.record(z.string(), z.unknown())),
      execute: getSandboxStep,
    }),
    createCheckpoint: defineAction({
      input: z.object({
        sandboxId: z.string(),
        comment: z.string().optional(),
      }),
      output: serviceResult(z.object({ checkpointId: z.string() })),
      execute: createCheckpointStep,
    }),
    getPortUrl: defineAction({
      input: z.object({
        sandboxId: z.string(),
        port: z.number(),
      }),
      output: serviceResult(z.object({ url: z.string() })),
      execute: getPortUrlStep,
    }),
    createEkairosApp: defineAction({
      input: z.object({
        sandboxId: z.string(),
        appDir: z.string(),
        packageManager: z.string().optional(),
        instantTokenEnvName: z.string().optional(),
      }),
      output: serviceResult(processRunResult),
      execute: createEkairosAppStep,
    }),
  })
}

export type SandboxDomain = ReturnType<typeof createSandboxDomain>
export const sandboxDomain: SandboxDomain = createSandboxDomain()

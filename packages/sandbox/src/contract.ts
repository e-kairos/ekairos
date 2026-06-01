import { z } from "zod"

export const SANDBOX_EXECUTE_COMMAND_ACTION_NAME = "executeCommand" as const

export const SANDBOX_PROCESS_KINDS = [
  "command",
  "service",
  "codex-app-server",
  "dev-server",
  "test-runner",
  "watcher",
] as const

export const SANDBOX_PROCESS_MODES = ["foreground", "background"] as const

export const SANDBOX_PROCESS_STATUSES = [
  "starting",
  "running",
  "detached",
  "exited",
  "failed",
  "killed",
  "lost",
] as const

export const SANDBOX_PROCESS_STREAM_CHUNK_TYPES = [
  "stdout",
  "stderr",
  "status",
  "exit",
  "error",
  "heartbeat",
  "metadata",
] as const

export const sandboxCommandResultSchema = z
  .object({
    success: z.boolean(),
    exitCode: z.number().optional(),
    output: z.string().optional(),
    error: z.string().optional(),
    streamingLogs: z.array(z.unknown()).optional(),
    command: z.string().optional(),
  })
  .passthrough()

export const sandboxProcessStreamChunkSchema = z
  .object({
    version: z.literal(1),
    at: z.string(),
    seq: z.number(),
    type: z.enum(SANDBOX_PROCESS_STREAM_CHUNK_TYPES),
    sandboxId: z.string(),
    processId: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export const sandboxProcessRunResultSchema = z
  .object({
    processId: z.string(),
    streamId: z.string(),
    streamClientId: z.string(),
    result: sandboxCommandResultSchema.optional(),
  })
  .passthrough()

export const sandboxExecuteCommandInputSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    cwd: z.string().min(1).optional(),
    env: z.record(z.string(), z.unknown()).optional(),
    kind: z.enum(SANDBOX_PROCESS_KINDS).optional(),
    mode: z.enum(SANDBOX_PROCESS_MODES).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const sandboxExecuteCommandOutputSchema = z.object({
  sandboxId: z.string().min(1).optional(),
  processId: z.string().min(1).optional(),
  streamId: z.string().min(1).optional(),
  streamClientId: z.string().min(1).optional(),
  success: z.boolean(),
  exitCode: z.number().int().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  command: z.string().optional(),
  status: z.string().optional(),
  durationMs: z.number().optional(),
})

export type SandboxProcessKind = (typeof SANDBOX_PROCESS_KINDS)[number]
export type SandboxProcessMode = (typeof SANDBOX_PROCESS_MODES)[number]
export type SandboxProcessStatus = (typeof SANDBOX_PROCESS_STATUSES)[number]
export type SandboxProcessStreamChunkType =
  (typeof SANDBOX_PROCESS_STREAM_CHUNK_TYPES)[number]
export type SandboxCommandResult = z.infer<typeof sandboxCommandResultSchema>
export type SandboxProcessStreamChunk = z.infer<typeof sandboxProcessStreamChunkSchema>
export type SandboxProcessRunResult = z.infer<typeof sandboxProcessRunResultSchema>
export type SandboxExecuteCommandInput = z.infer<typeof sandboxExecuteCommandInputSchema>
export type SandboxExecuteCommandOutput = z.infer<typeof sandboxExecuteCommandOutputSchema>

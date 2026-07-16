/**
 * Lightweight filesystem/process handle used by Reaction operations.
 *
 * A sandbox is deliberately unaware of Context, Events, and Dataset sources.
 * Callers decide what to materialize and every such operation is persisted by
 * the Reaction that requested it.
 *
 * The handle contains durable identity and delegates every operation by
 * sandbox ID. It does not represent a retained provider session.
 */
export type ContextSandboxHandle = {
  id: string
  provider: string
  workspaceRoot: string
  writeFile(file: {
    path: string
    content: string | Uint8Array | Buffer
    encoding?: "utf-8" | "base64"
  }): Promise<void>
  writeFiles(files: Array<{
    path: string
    content: string | Uint8Array | Buffer
    encoding?: "utf-8" | "base64"
  }>): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  exists(path: string): Promise<boolean>
  exec(input: {
    command: string
    args?: string[]
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
    signal?: AbortSignal
  }): Promise<unknown>
  stop(): Promise<void>
}

/**
 * Local codex app-server, fully encapsulated by the codex reactor.
 *
 * Apps using `createCodexReactor` with `mode: "local"` never touch the
 * codex process: this module resolves the native binary behind the npm
 * shim, spawns `codex app-server` (line-delimited JSON-RPC over stdio),
 * and exposes it through a loopback HTTP bridge with the exact contract
 * the reactor's default turn step consumes (`POST /rpc` + `GET /events`
 * SSE). One process + bridge per Node process, started lazily.
 *
 * The binary is spawned directly (no shell): cmd/powershell layers mangle
 * the quotes inside TOML `-c` overrides.
 */
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"

type JsonRecord = Record<string, unknown>

const RPC_TIMEOUT_MS = 120_000

function resolveCodexBinary(): string {
  const override = process.env.EKAIROS_CODEX_BINARY?.trim()
  if (override && existsSync(override)) return override
  if (process.platform !== "win32") return "codex"
  try {
    const where = spawnSync("where.exe", ["codex.cmd"], { encoding: "utf8" })
    const shim = where.stdout.trim().split(/\r?\n/)[0] ?? ""
    if (shim) {
      const base = dirname(shim)
      const candidates = [
        join(
          base,
          "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe",
        ),
        join(
          base,
          "node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe",
        ),
        join(
          base,
          "node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/codex/codex.exe",
        ),
      ]
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate
      }
    }
  } catch {
    // fall through to PATH resolution
  }
  return "codex.exe"
}

class LocalCodexAppServer {
  #child: ChildProcessWithoutNullStreams | null = null
  #pending = new Map<
    string,
    { resolve: (msg: JsonRecord) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >()
  #watchers = new Set<(event: JsonRecord) => void>()
  #starting: Promise<void> | null = null
  #overrides: string[]

  constructor(overrides: string[]) {
    this.#overrides = overrides
  }

  subscribe(handler: (event: JsonRecord) => void): () => void {
    this.#watchers.add(handler)
    return () => this.#watchers.delete(handler)
  }

  async ensureStarted(): Promise<void> {
    if (this.#child) return
    if (!this.#starting) {
      this.#starting = this.#start().catch((error) => {
        this.#starting = null
        throw error
      })
    }
    await this.#starting
  }

  /** server→client request responses (e.g. dynamic tool results) */
  respond(payload: JsonRecord): void {
    const child = this.#child
    if (!child) throw new Error("codex_not_started")
    if (payload.id === undefined || payload.id === null) {
      throw new Error("response_id_required")
    }
    child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  async rpc(method: string, params: JsonRecord): Promise<JsonRecord> {
    await this.ensureStarted()
    const child = this.#child
    if (!child) throw new Error("codex_not_started")
    const id = randomUUID()
    return await new Promise<JsonRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`codex_rpc_timeout:${method}`))
      }, RPC_TIMEOUT_MS)
      this.#pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  async #start(): Promise<void> {
    const args = ["app-server"]
    for (const override of this.#overrides) {
      args.push("-c", override)
    }
    const child = spawn(resolveCodexBinary(), args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    })

    child.on("error", (error) => {
      this.#failAllPending(new Error(`codex_spawn_failed: ${error.message}`))
      this.#child = null
      this.#starting = null
    })
    child.on("exit", (code) => {
      this.#failAllPending(new Error(`codex_exited:${code ?? "unknown"}`))
      this.#child = null
      this.#starting = null
    })
    child.stderr.on("data", () => {
      // codex logs to stderr; keep the pipe drained
    })

    const reader = createInterface({ input: child.stdout })
    reader.on("line", (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let message: JsonRecord
      try {
        message = JSON.parse(trimmed) as JsonRecord
      } catch {
        return
      }
      const id = typeof message.id === "string" ? message.id : ""
      if (id && this.#pending.has(id)) {
        const entry = this.#pending.get(id)!
        this.#pending.delete(id)
        clearTimeout(entry.timer)
        if (message.error !== undefined && message.error !== null) {
          const rpcError =
            message.error && typeof message.error === "object"
              ? (message.error as JsonRecord)
              : {}
          entry.reject(
            new Error(String(rpcError.message ?? message.error ?? "codex_rpc_error")),
          )
          return
        }
        entry.resolve(message)
        return
      }
      for (const watcher of this.#watchers) {
        try {
          watcher(message)
        } catch {
          // watchers must not break the rpc loop
        }
      }
    })

    this.#child = child

    await this.#rpcRaw("initialize", {
      clientInfo: { name: "ekairos-codex-reactor", version: "1.0.0" },
      // dynamicTools (context actions as codex tools) lives behind the
      // experimental API surface
      capabilities: { experimentalApi: true },
    })
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`)
  }

  async #rpcRaw(method: string, params: JsonRecord): Promise<JsonRecord> {
    const child = this.#child
    if (!child) throw new Error("codex_not_started")
    const id = randomUUID()
    return await new Promise<JsonRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`codex_rpc_timeout:${method}`))
      }, RPC_TIMEOUT_MS)
      this.#pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  #failAllPending(error: Error): void {
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.#pending.clear()
  }
}

const bridges = new Map<string, Promise<string>>()

async function startBridge(overrides: string[]): Promise<string> {
  const server = new LocalCodexAppServer(overrides)
  await server.ensureStarted()

  const http = createServer((request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/events")) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      response.write(":ok\n\n")
      const unsubscribe = server.subscribe((event) => {
        response.write(`data: ${JSON.stringify(event)}\n\n`)
      })
      request.on("close", () => {
        unsubscribe()
        response.end()
      })
      return
    }

    if (request.method === "POST" && request.url?.startsWith("/respond")) {
      let body = ""
      request.on("data", (chunk) => {
        body += String(chunk)
      })
      request.on("end", () => {
        try {
          server.respond(JSON.parse(body) as JsonRecord)
          response.writeHead(200, { "content-type": "application/json" })
          response.end(JSON.stringify({ ok: true }))
        } catch (error) {
          response.writeHead(500, { "content-type": "application/json" })
          response.end(JSON.stringify({ error: String(error).slice(0, 400) }))
        }
      })
      return
    }

    if (request.method === "POST" && request.url?.startsWith("/rpc")) {
      let body = ""
      request.on("data", (chunk) => {
        body += String(chunk)
      })
      request.on("end", () => {
        void (async () => {
          try {
            const parsed = JSON.parse(body) as JsonRecord
            const message = await server.rpc(
              String(parsed.method ?? ""),
              (parsed.params ?? {}) as JsonRecord,
            )
            response.writeHead(200, { "content-type": "application/json" })
            response.end(JSON.stringify(message))
          } catch (error) {
            response.writeHead(500, { "content-type": "application/json" })
            response.end(
              JSON.stringify({ error: String(error).slice(0, 400) }),
            )
          }
        })()
      })
      return
    }

    console.warn(
      `[codex-local-bridge] unmatched ${request.method} ${request.url}`,
    )
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: "not_found" }))
  })

  await new Promise<void>((resolve) => {
    http.listen(0, "127.0.0.1", () => resolve())
  })
  const address = http.address()
  const port = typeof address === "object" && address ? address.port : 0
  return `http://127.0.0.1:${port}`
}

/**
 * Lazily start (once per overrides-set) a local codex app-server plus its
 * loopback bridge, returning the base URL for the reactor's default turn
 * step. Used when `CodexConfig.mode === "local"`.
 */
export function ensureLocalCodexAppServerUrl(
  overrides: string[] = [],
): Promise<string> {
  const key = overrides.join(" ")
  let bridge = bridges.get(key)
  if (!bridge) {
    bridge = startBridge(overrides).catch((error) => {
      bridges.delete(key)
      throw error
    })
    bridges.set(key, bridge)
  }
  return bridge
}

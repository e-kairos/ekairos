import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:net"
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { PlatformApi } from "@instantdb/platform"
import { i } from "@instantdb/core"
import { domain } from "../index.js"

export type CreateDomainAppProgressStage =
  | "prepare-target"
  | "detect-package-manager"
  | "resolve-version"
  | "provision-instant"
  | "write-files"
  | "write-env"
  | "install"
  | "smoke"
  | "complete"

export type CreateDomainAppProgressEvent = {
  stage: CreateDomainAppProgressStage
  status: "running" | "completed" | "log"
  message: string
  progress?: number
}

export type CreateDomainAppParams = {
  directory: string
  framework: "next"
  install: boolean
  template?: CreateDomainAppTemplate
  demo?: boolean
  force?: boolean
  packageManager?: string
  workspacePath?: string
  instantToken?: string
  orgId?: string
  appId?: string
  adminToken?: string
  smoke?: boolean
  keepServer?: boolean
  onKeepServer?: (server: { unref: () => void }) => void
  onProgress?: (event: CreateDomainAppProgressEvent) => void | Promise<void>
}

export type CreateDomainAppSmokeResult = {
  ok: true
  baseUrl: string
  keepServer: boolean
  pid: number | null
  typecheck: true
  domainEndpoint: true
  inspect: {
    entities: number
    actions: number
  }
  launchedOrder: boolean
  query: {
    inspections: number
    orders: number
    shipments: number
  }
}

export const CREATE_DOMAIN_APP_TEMPLATES = ["empty", "supply-chain", "agent"] as const
export type CreateDomainAppTemplate = (typeof CREATE_DOMAIN_APP_TEMPLATES)[number]

export type CreateDomainAppResult = {
  ok: true
  directory: string
  framework: "next"
  template: CreateDomainAppTemplate
  installed: boolean
  packageManager: string
  provisioned: boolean
  appId: string | null
  adminToken: string | null
  adminTokenWritten: boolean
  envFile: string | null
  smoke: CreateDomainAppSmokeResult | null
  demo: boolean
  nextSteps: string[]
}

const TEMPLATE_NEXT_VERSION = "16.2.6"
const TEMPLATE_REACT_VERSION = "19.2.6"
const TEMPLATE_TYPESCRIPT_VERSION = "^6.0.3"
const TEMPLATE_INSTANT_VERSION = "1.0.39"
const TEMPLATE_INSTANT_REACT_VERSION = "1.0.39"
const TEMPLATE_WORKFLOW_VERSION = "5.0.0-beta.6"
const TEMPLATE_VERCEL_OIDC_VERSION = "3.4.1"
const TEMPLATE_EVENTS_VERSION = "1.22.82-beta.development.0"

function trimOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

async function emitProgress(
  onProgress: CreateDomainAppParams["onProgress"],
  event: CreateDomainAppProgressEvent,
) {
  if (!onProgress) return
  await onProgress(event)
}

function toPosix(value: string) {
  return value.replace(/\\/g, "/")
}

async function detectPackageManager(explicit?: string, workspacePath?: string) {
  const normalized = trimOrEmpty(explicit).toLowerCase()
  if (normalized) return normalized

  for (const root of [trimOrEmpty(workspacePath), process.cwd()].filter(Boolean)) {
    if (await pathExists(join(root, "pnpm-lock.yaml"))) return "pnpm"
    if (await pathExists(join(root, "yarn.lock"))) return "yarn"
    if (await pathExists(join(root, "bun.lockb"))) return "bun"
  }

  const agent = trimOrEmpty(process.env.npm_config_user_agent)
  if (agent.startsWith("pnpm/")) return "pnpm"
  if (agent.startsWith("yarn/")) return "yarn"
  if (agent.startsWith("bun/")) return "bun"
  return "npm"
}

async function pathExists(pathname: string) {
  try {
    await access(pathname)
    return true
  } catch {
    return false
  }
}

async function ensureWritableTargetDirectory(targetDir: string, force = false) {
  await mkdir(targetDir, { recursive: true })
  const entries = await readdir(targetDir)
  if (entries.length === 0) return
  if (!force) {
    throw new Error(`Target directory is not empty: ${targetDir}`)
  }

  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
}

async function readDomainPackageVersion() {
  const packageJsonPath = new URL("../../package.json", import.meta.url)
  const raw = await readFile(packageJsonPath, "utf8")
  const parsed = JSON.parse(raw) as { version?: string }
  return trimOrEmpty(parsed.version) || "latest"
}

export function normalizeCreateAppTemplate(value: unknown): CreateDomainAppTemplate | null {
  const normalized = trimOrEmpty(value)
  if (!normalized) return null
  if ((CREATE_DOMAIN_APP_TEMPLATES as readonly string[]).includes(normalized)) {
    return normalized as CreateDomainAppTemplate
  }
  throw new Error(
    `Unsupported template: ${normalized}. Supported templates: ${CREATE_DOMAIN_APP_TEMPLATES.join(", ")}.`,
  )
}

function resolveCreateAppTemplate(params: {
  demo?: boolean
  template?: CreateDomainAppTemplate | null
}) {
  if (params.template) {
    if (params.demo && params.template !== "supply-chain") {
      throw new Error("--demo only supports --template=supply-chain.")
    }
    return params.template
  }
  return params.demo ? "supply-chain" : "empty"
}

function createScaffoldSchema(template: CreateDomainAppTemplate) {
  if (template === "supply-chain") return createSupplyChainScaffoldSchema()
  if (template === "agent") return createAgentScaffoldSchema()
  return createEmptyScaffoldSchema()
}

function createEmptyScaffoldSchema() {
  const scaffoldDomain = domain("app").withSchema({
    entities: {},
    links: {},
    rooms: {},
  })

  return scaffoldDomain.toInstantSchema()
}

function createSupplyChainScaffoldSchema() {
  const supplierNetworkDomain = domain("supplierNetwork").withSchema({
    entities: {
      supplierNetwork_supplier: i.entity({
        name: i.string().indexed(),
        region: i.string().indexed(),
        risk: i.string().indexed(),
        score: i.number().indexed(),
        createdAt: i.number().indexed(),
      }),
    },
    links: {},
    rooms: {},
  })

  const procurementDomain = domain("procurement")
    .includes(supplierNetworkDomain)
    .withSchema({
      entities: {
        procurement_order: i.entity({
          reference: i.string().indexed(),
          status: i.string().indexed(),
          spend: i.number().indexed(),
          createdAt: i.number().indexed(),
        }),
      },
      links: {
        procurement_orderSupplier: {
          forward: { on: "procurement_order", has: "one", label: "supplier" },
          reverse: { on: "supplierNetwork_supplier", has: "many", label: "orders" },
        },
      },
      rooms: {},
    })

  const inventoryDomain = domain("inventory")
    .includes(procurementDomain)
    .withSchema({
      entities: {
        inventory_stockItem: i.entity({
          sku: i.string().indexed(),
          warehouse: i.string().indexed(),
          available: i.number().indexed(),
          safetyStock: i.number().indexed(),
          createdAt: i.number().indexed(),
        }),
      },
      links: {
        inventory_stockItemOrder: {
          forward: { on: "inventory_stockItem", has: "one", label: "order" },
          reverse: { on: "procurement_order", has: "many", label: "stockItems" },
        },
      },
      rooms: {},
    })

  const transportationDomain = domain("transportation")
    .includes(procurementDomain)
    .withSchema({
      entities: {
        transportation_shipment: i.entity({
          carrier: i.string().indexed(),
          lane: i.string().indexed(),
          status: i.string().indexed(),
          etaHours: i.number().indexed(),
          createdAt: i.number().indexed(),
        }),
      },
      links: {
        transportation_shipmentOrder: {
          forward: { on: "transportation_shipment", has: "one", label: "order" },
          reverse: { on: "procurement_order", has: "many", label: "shipments" },
        },
      },
      rooms: {},
    })

  const qualityControlDomain = domain("qualityControl")
    .includes(transportationDomain)
    .withSchema({
      entities: {
        qualityControl_inspection: i.entity({
          result: i.string().indexed(),
          severity: i.string().indexed(),
          note: i.string(),
          createdAt: i.number().indexed(),
        }),
      },
      links: {
        qualityControl_inspectionShipment: {
          forward: { on: "qualityControl_inspection", has: "one", label: "shipment" },
          reverse: { on: "transportation_shipment", has: "many", label: "inspections" },
        },
      },
      rooms: {},
    })

  const scaffoldDomain = domain("supplyChain")
    .includes(inventoryDomain)
    .includes(qualityControlDomain)
    .withSchema({ entities: {}, links: {}, rooms: {} })

  return scaffoldDomain.toInstantSchema()
}

function createAgentScaffoldSchema() {
  return domain("events")
    .withSchema({
      entities: {
        event_contexts: i.entity({
          createdAt: i.date(),
          updatedAt: i.date().optional(),
          key: i.string().optional().indexed().unique(),
          name: i.string().optional(),
          status: i.string().optional().indexed(),
          content: i.any().optional(),
          reactor: i.json().optional(),
        }),
        event_items: i.entity({
          channel: i.string().indexed(),
          createdAt: i.date().indexed(),
          type: i.string().optional().indexed(),
          content: i.any().optional(),
          status: i.string().optional().indexed(),
        }),
        event_executions: i.entity({
          createdAt: i.date(),
          updatedAt: i.date().optional(),
          status: i.string().optional().indexed(),
          workflowRunId: i.string().optional().indexed(),
          activeStreamId: i.string().optional().indexed(),
          activeStreamClientId: i.string().optional().indexed(),
          lastStreamId: i.string().optional().indexed(),
          lastStreamClientId: i.string().optional().indexed(),
        }),
        event_steps: i.entity({
          createdAt: i.date().indexed(),
          updatedAt: i.date().optional(),
          status: i.string().optional().indexed(),
          iteration: i.number().indexed(),
          errorText: i.string().optional(),
          streamId: i.string().optional().indexed(),
          streamClientId: i.string().optional().indexed(),
          streamStartedAt: i.date().optional().indexed(),
          streamFinishedAt: i.date().optional().indexed(),
          streamAbortReason: i.string().optional(),
        }),
        event_parts: i.entity({
          key: i.string().unique().indexed(),
          stepId: i.string().indexed(),
          idx: i.number().indexed(),
          type: i.string().optional().indexed(),
          part: i.json().optional(),
          metadata: i.json().optional(),
          updatedAt: i.date().optional(),
        }),
        event_trace_events: i.entity({
          key: i.string().unique().indexed(),
          workflowRunId: i.string().indexed(),
          seq: i.number().indexed(),
          eventId: i.string().indexed(),
          eventKind: i.string().indexed(),
          eventAt: i.date().optional(),
          ingestedAt: i.date().optional(),
          orgId: i.string().optional().indexed(),
          projectId: i.string().optional().indexed(),
          contextKey: i.string().optional().indexed(),
          contextId: i.string().optional().indexed(),
          executionId: i.string().optional().indexed(),
          stepId: i.string().optional().indexed(),
          contextEventId: i.string().optional().indexed(),
          toolCallId: i.string().optional().indexed(),
          partKey: i.string().optional().indexed(),
          partIdx: i.number().optional().indexed(),
          spanId: i.string().optional().indexed(),
          parentSpanId: i.string().optional().indexed(),
          isDeleted: i.boolean().optional(),
          aiProvider: i.string().optional().indexed(),
          aiModel: i.string().optional().indexed(),
          promptTokens: i.number().optional(),
          promptTokensCached: i.number().optional(),
          promptTokensUncached: i.number().optional(),
          completionTokens: i.number().optional(),
          totalTokens: i.number().optional(),
          latencyMs: i.number().optional(),
          cacheCostUsd: i.number().optional(),
          computeCostUsd: i.number().optional(),
          costUsd: i.number().optional(),
          payload: i.any().optional(),
        }),
        event_trace_runs: i.entity({
          workflowRunId: i.string().unique().indexed(),
          orgId: i.string().optional().indexed(),
          projectId: i.string().optional().indexed(),
          firstEventAt: i.date().optional().indexed(),
          lastEventAt: i.date().optional().indexed(),
          lastIngestedAt: i.date().optional().indexed(),
          eventsCount: i.number().optional(),
          status: i.string().optional().indexed(),
          payload: i.any().optional(),
        }),
        event_trace_spans: i.entity({
          spanId: i.string().unique().indexed(),
          parentSpanId: i.string().optional().indexed(),
          workflowRunId: i.string().indexed(),
          executionId: i.string().optional().indexed(),
          stepId: i.string().optional().indexed(),
          kind: i.string().optional().indexed(),
          name: i.string().optional().indexed(),
          status: i.string().optional().indexed(),
          startedAt: i.date().optional().indexed(),
          endedAt: i.date().optional().indexed(),
          durationMs: i.number().optional(),
          payload: i.any().optional(),
        }),
        document_documents: i.entity({
          name: i.string().optional().indexed(),
          mimeType: i.string().optional(),
          size: i.number().optional(),
          ownerId: i.string().optional().indexed(),
          orgId: i.string().optional().indexed(),
          createdAt: i.date().optional().indexed(),
          processedAt: i.date().optional().indexed(),
          updatedAt: i.date().optional(),
          lastJobId: i.string().optional(),
          content: i.json().optional(),
        }),
      },
      links: {
        contextItemsContext: {
          forward: { on: "event_items", has: "one", label: "context" },
          reverse: { on: "event_contexts", has: "many", label: "items" },
        },
        contextExecutionsContext: {
          forward: { on: "event_executions", has: "one", label: "context" },
          reverse: { on: "event_contexts", has: "many", label: "executions" },
        },
        contextCurrentExecution: {
          forward: { on: "event_contexts", has: "one", label: "currentExecution" },
          reverse: { on: "event_executions", has: "one", label: "currentOf" },
        },
        contextExecutionsTrigger: {
          forward: { on: "event_executions", has: "one", label: "trigger" },
          reverse: { on: "event_items", has: "many", label: "executionsAsTrigger" },
        },
        contextExecutionsReaction: {
          forward: { on: "event_executions", has: "one", label: "reaction" },
          reverse: { on: "event_items", has: "many", label: "executionsAsReaction" },
        },
        contextStepsExecution: {
          forward: { on: "event_steps", has: "one", label: "execution" },
          reverse: { on: "event_executions", has: "many", label: "steps" },
        },
        contextExecutionItems: {
          forward: { on: "event_items", has: "one", label: "execution" },
          reverse: { on: "event_executions", has: "many", label: "items" },
        },
        contextPartsStep: {
          forward: { on: "event_parts", has: "one", label: "step" },
          reverse: { on: "event_steps", has: "many", label: "parts" },
        },
        contextStepStream: {
          forward: { on: "event_steps", has: "one", label: "stream" },
          reverse: { on: "$streams", has: "many", label: "step" },
        },
        contextExecutionActiveStream: {
          forward: { on: "event_executions", has: "one", label: "activeStream" },
          reverse: { on: "$streams", has: "many", label: "activeOf" },
        },
        contextExecutionLastStream: {
          forward: { on: "event_executions", has: "one", label: "lastStream" },
          reverse: { on: "$streams", has: "many", label: "lastOf" },
        },
        documentFile: {
          forward: { on: "document_documents", has: "one", label: "file" },
          reverse: { on: "$files", has: "one", label: "document" },
        },
      },
      rooms: {},
    })
    .toInstantSchema()
}

function createScaffoldPerms(template: CreateDomainAppTemplate) {
  if (template === "supply-chain") return createSupplyChainScaffoldPerms()
  if (template === "agent") return createAgentScaffoldPerms()
  return createEmptyScaffoldPerms()
}

function createEmptyScaffoldPerms() {
  return {
    attrs: {
      allow: { create: "true" },
    },
  } as any
}

function createSupplyChainScaffoldPerms() {
  const entityRules = {
    bind: ["isLoggedIn", "auth.id != null"],
    allow: {
      view: "true",
      create: "isLoggedIn",
      update: "isLoggedIn",
      delete: "false",
    },
  }

  return {
    attrs: {
      allow: { create: "true" },
    },
    supplierNetwork_supplier: entityRules,
    procurement_order: entityRules,
    inventory_stockItem: entityRules,
    transportation_shipment: entityRules,
    qualityControl_inspection: entityRules,
  } as any
}

function createAgentScaffoldPerms() {
  const entityRules = {
    allow: {
      view: "true",
      create: "true",
      update: "true",
      delete: "false",
    },
  }

  return {
    attrs: {
      allow: { create: "true" },
    },
    event_contexts: entityRules,
    event_items: entityRules,
    event_executions: entityRules,
    event_steps: entityRules,
    event_parts: entityRules,
    event_trace_events: entityRules,
    event_trace_runs: entityRules,
    event_trace_spans: entityRules,
    document_documents: entityRules,
  } as any
}

function installCommandFor(packageManager: string) {
  if (packageManager === "pnpm") return "pnpm install"
  if (packageManager === "yarn") return "yarn install"
  if (packageManager === "bun") return "bun install"
  return "npm install"
}

function runScriptCommandFor(packageManager: string, script: string) {
  if (packageManager === "pnpm") return `pnpm ${script}`
  if (packageManager === "yarn") return `yarn ${script}`
  if (packageManager === "bun") return `bun run ${script}`
  return `npm run ${script}`
}

function packageBinCommandFor(packageManager: string, command: string) {
  void command
  return "ekairos domain"
}

function typecheckCommandFor(packageManager: string) {
  if (packageManager === "pnpm") return { command: "pnpm", args: ["typecheck"] }
  if (packageManager === "yarn") return { command: "yarn", args: ["typecheck"] }
  if (packageManager === "bun") return { command: "bun", args: ["run", "typecheck"] }
  return { command: "npm", args: ["run", "typecheck"] }
}

function nextDevCommandFor(targetDir: string, port: number) {
  return {
    command: process.execPath,
    args: [
      join(targetDir, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
  }
}

async function runCommand(params: {
  targetDir: string
  command: string
  args: string[]
  timeoutMs?: number
}) {
  const timeoutMs = params.timeoutMs ?? 2 * 60 * 1000
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(params.command, params.args, {
      cwd: params.targetDir,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "pipe",
    })

    let output = ""
    const timer = setTimeout(() => {
      stopProcess(child.pid)
      rejectRun(new Error(`${params.command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      output += chunk.toString()
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      rejectRun(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolveRun()
        return
      }
      rejectRun(
        new Error(
          output.trim() || `${params.command} failed with exit code ${code ?? "unknown"}`,
        ),
      )
    })
  })
}

async function reservePort() {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer()
    server.once("error", rejectPort)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        rejectPort(new Error("Failed to reserve smoke port"))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) rejectPort(error)
        else resolvePort(port)
      })
    })
  })
}

function stopProcess(pid: number | undefined) {
  if (!pid) return
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    })
    return
  }
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Process already exited.
    }
  }
}

function quotePowerShellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function startDetachedWindowsProcess(params: {
  args: string[]
  command: string
  targetDir: string
}) {
  const argumentList = params.args.map(quotePowerShellString).join(", ")
  const script = [
    `$p = Start-Process -FilePath ${quotePowerShellString(params.command)} ` +
      `-ArgumentList @(${argumentList}) ` +
      `-WorkingDirectory ${quotePowerShellString(params.targetDir)} ` +
      "-WindowStyle Hidden -PassThru",
    "Write-Output $p.Id",
  ].join("; ")

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  )

  if ((result.status ?? 1) !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        result.stdout?.trim() ||
        "Failed to start detached Next dev server",
    )
  }

  const pid = Number(String(result.stdout ?? "").trim().split(/\s+/).pop())
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit, timeoutMs = 10_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    })
    const data = await response.json().catch(() => null)
    return { response, data: data as any }
  } finally {
    clearTimeout(timer)
  }
}

async function waitForDomainEndpoint(params: {
  baseUrl: string
  processExited: () => boolean
  readLogs: () => string
}) {
  const endpoint = `${params.baseUrl}/api/ekairos/domain`
  const deadline = Date.now() + 3 * 60 * 1000
  let lastError = ""

  while (Date.now() < deadline) {
    if (params.processExited()) {
      throw new Error(`Next dev server exited before smoke endpoint was ready.\n${params.readLogs()}`)
    }

    try {
      const { response, data } = await fetchJsonWithTimeout(endpoint)
      if (response.ok && data?.ok === true) return data
      lastError = `status:${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
  }

  throw new Error(`Timed out waiting for ${endpoint}: ${lastError}\n${params.readLogs()}`)
}

function countCollection(value: unknown) {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length
  return 0
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

async function postSmokeJson(baseUrl: string, body: Record<string, unknown>) {
  const { response, data } = await fetchJsonWithTimeout(
    `${baseUrl}/api/ekairos/domain`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    30_000,
  )
  if (!response.ok || data?.ok !== true) {
    throw new Error(
      data?.error || `Smoke request failed with status ${response.status}`,
    )
  }
  return data
}

async function runSmoke(params: {
  demo?: boolean
  targetDir: string
  packageManager: string
  keepServer: boolean
  onKeepServer?: CreateDomainAppParams["onKeepServer"]
  onProgress?: CreateDomainAppParams["onProgress"]
}): Promise<CreateDomainAppSmokeResult> {
  await emitProgress(params.onProgress, {
    stage: "smoke",
    status: "running",
    message: "Running typecheck",
    progress: 97,
  })
  const typecheck = typecheckCommandFor(params.packageManager)
  await runCommand({
    targetDir: params.targetDir,
    command: typecheck.command,
    args: typecheck.args,
  })

  const port = await reservePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const dev = nextDevCommandFor(params.targetDir, port)
  let logs = ""
  let smokePassed = false
  let detachedPid: number | null = null
  const child =
    params.keepServer && process.platform === "win32"
      ? null
      : spawn(dev.command, dev.args, {
          cwd: params.targetDir,
          env: process.env,
          detached: params.keepServer,
          shell: false,
          stdio: params.keepServer ? "ignore" : "pipe",
        })

  if (params.keepServer && process.platform === "win32") {
    detachedPid = startDetachedWindowsProcess({
      targetDir: params.targetDir,
      command: dev.command,
      args: dev.args,
    })
  }

  if (child && !params.keepServer) {
    child.stdout?.on("data", (chunk) => {
      logs += chunk.toString()
    })
    child.stderr?.on("data", (chunk) => {
      logs += chunk.toString()
    })
  }

  try {
    await emitProgress(params.onProgress, {
      stage: "smoke",
      status: "running",
      message: `Waiting for ${baseUrl}`,
      progress: 98,
    })
    const manifest = await waitForDomainEndpoint({
      baseUrl,
      processExited: () => (child ? child.exitCode !== null : false),
      readLogs: () => logs,
    })

    let launchedOrder = false
    let orders: unknown[] = []
    let shipments = 0
    let inspections = 0

    if (params.demo) {
      const launch = await postSmokeJson(baseUrl, {
        op: "action",
        action: "supplyChain.order.launch",
        input: {
          reference: "PO-SMOKE-7842",
          sku: "DRV-2048",
          supplierName: "Marula Components",
        },
        admin: true,
      })
      if (String(launch.action ?? "") !== "supplyChain.order.launch") {
        throw new Error("Smoke launch order action returned an unexpected action")
      }
      launchedOrder = true

      const query = await postSmokeJson(baseUrl, {
        op: "query",
        query: {
          procurement_order: {
            supplier: {},
            stockItems: {},
            shipments: {
              inspections: {},
            },
          },
        },
        admin: true,
      })
      orders = asArray(query?.data?.procurement_order)
      shipments = orders.reduce<number>((total, order) => {
        return total + asArray((order as any)?.shipments).length
      }, 0)
      inspections = orders.reduce<number>((total, order) => {
        const orderShipments = asArray((order as any)?.shipments)
        return total + orderShipments.reduce<number>((shipmentTotal, shipment) => {
          return shipmentTotal + asArray((shipment as any)?.inspections).length
        }, 0)
      }, 0)
    }

    smokePassed = true

    const result: CreateDomainAppSmokeResult = {
      ok: true,
      baseUrl,
      keepServer: params.keepServer,
      pid: detachedPid ?? child?.pid ?? null,
      typecheck: true,
      domainEndpoint: true,
      inspect: {
        entities: countCollection(manifest?.domain?.entities),
        actions: countCollection(manifest?.actions),
      },
      launchedOrder,
      query: {
        inspections,
        orders: orders.length,
        shipments,
      },
    }

    await emitProgress(params.onProgress, {
      stage: "smoke",
      status: "completed",
      message: params.keepServer
        ? `Smoke passed and server is running at ${baseUrl}`
        : "Smoke passed",
      progress: 99,
    })

    if (params.keepServer) {
      params.onKeepServer?.({
        unref() {
          child?.unref()
        },
      })
    }

    return result
  } finally {
    if (!params.keepServer || !smokePassed) {
      stopProcess(detachedPid ?? child?.pid)
    }
  }
}

async function provisionInstantApp(params: {
  directory: string
  template: CreateDomainAppTemplate
  instantToken: string
  orgId?: string
}) {
  const api = new PlatformApi({
    auth: { token: params.instantToken },
  })

  const created = await api.createApp({
    title: `ekairos-${trimOrEmpty(params.directory.split(/[\\/]/).pop()) || "app"}`,
    orgId: trimOrEmpty(params.orgId) || undefined,
    schema: createScaffoldSchema(params.template),
    perms: createScaffoldPerms(params.template),
  })

  const appId = trimOrEmpty(created?.app?.id)
  const adminToken = trimOrEmpty((created?.app as any)?.adminToken)
  if (!appId || !adminToken) {
    throw new Error("Instant app provisioning did not return appId/adminToken")
  }

  return {
    appId,
    adminToken,
  }
}

async function runInstall(
  targetDir: string,
  packageManager: string,
  onProgress?: CreateDomainAppParams["onProgress"],
) {
  const command =
    packageManager === "yarn"
      ? "yarn"
      : packageManager === "bun"
        ? "bun"
        : packageManager === "pnpm"
          ? "pnpm"
          : "npm"

  const args =
    command === "yarn"
      ? ["install"]
      : command === "bun"
        ? ["install"]
        : command === "pnpm"
          ? ["install"]
          : ["install"]

  await new Promise<void>((resolveInstall, rejectInstall) => {
    const emitChunk = (() => {
      let buffer = ""
      return async (chunk: string) => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          const text = line.trim()
          if (!text) continue
          await emitProgress(onProgress, {
            stage: "install",
            status: "log",
            message: text,
          })
        }
      }
    })()

    const child = spawn(command, args, {
      cwd: targetDir,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "pipe",
    })

    let stderr = ""
    child.stdout.on("data", (chunk) => {
      void emitChunk(chunk.toString())
    })
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString()
      stderr += text
      void emitChunk(text)
    })

    child.on("error", rejectInstall)
    child.on("close", (code) => {
      if (code === 0) {
        resolveInstall()
        return
      }
      rejectInstall(
        new Error(
          stderr.trim() || `${command} install failed with exit code ${code ?? "unknown"}`,
        ),
      )
    })
  })
}

async function writeScaffoldFiles(targetDir: string, files: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(targetDir, relativePath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content, "utf8")
  }
}

function resolveWorkspacePackageDependencyVersion(
  packageName: string,
  version: string,
  targetDir: string,
  workspacePath?: string,
) {
  const workspaceRoot = trimOrEmpty(workspacePath)
  if (!workspaceRoot) {
    return version
  }

  const packageRoot = resolve(workspaceRoot, "packages", packageName.split("/").pop() || packageName)
  const relativePath = toPosix(relative(targetDir, packageRoot))
  if (!relativePath) return "file:."
  const prefixed = relativePath.startsWith(".") ? relativePath : `./${relativePath}`
  return `file:${prefixed}`
}

function resolveDomainDependencyVersion(
  version: string,
  targetDir: string,
  workspacePath?: string,
) {
  return resolveWorkspacePackageDependencyVersion(
    "@ekairos/domain",
    version,
    targetDir,
    workspacePath,
  )
}

function buildNextTemplateFiles(params: {
  template: CreateDomainAppTemplate
  targetDir: string
  domainVersion: string
  packageManager: string
  workspacePath?: string
}): Record<string, string> {
  const workspaceRoot = trimOrEmpty(params.workspacePath)
  const domainDependency =
    params.template === "agent" && !workspaceRoot
      ? TEMPLATE_EVENTS_VERSION
      : resolveDomainDependencyVersion(
          params.domainVersion,
          params.targetDir,
          params.workspacePath,
        )
  const eventsDependency = resolveWorkspacePackageDependencyVersion(
    "@ekairos/events",
    TEMPLATE_EVENTS_VERSION,
    params.targetDir,
    params.workspacePath,
  )

  const packageJson = {
    name: trimOrEmpty(params.targetDir.split(/[\\/]/).pop()) || "ekairos-app",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: {
      build: "next build",
      dev: "next dev",
      start: "next start",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      "@ekairos/domain": domainDependency,
      "@vercel/oidc": TEMPLATE_VERCEL_OIDC_VERSION,
      "@instantdb/admin": TEMPLATE_INSTANT_VERSION,
      "@instantdb/core": TEMPLATE_INSTANT_VERSION,
      "@instantdb/react": TEMPLATE_INSTANT_REACT_VERSION,
      next: TEMPLATE_NEXT_VERSION,
      react: TEMPLATE_REACT_VERSION,
      "react-dom": TEMPLATE_REACT_VERSION,
      workflow: TEMPLATE_WORKFLOW_VERSION,
      zod: "^4.3.6",
    },
    devDependencies: {
      "@types/node": "^24.5.0",
      "@types/react": "^19.2.2",
      "@types/react-dom": "^19.2.2",
      typescript: TEMPLATE_TYPESCRIPT_VERSION,
    },
    packageManager:
      params.packageManager === "pnpm"
      ? "pnpm@10.15.1"
      : params.packageManager === "yarn"
        ? "yarn@1"
        : undefined,
  }

  if (params.template === "agent") {
    ;(packageJson.dependencies as Record<string, string>)["@ekairos/events"] = eventsDependency
    if (params.packageManager === "pnpm") {
      ;(packageJson as { pnpm?: { overrides: Record<string, string> } }).pnpm = {
        overrides: {
          "@ekairos/domain": domainDependency,
          "@instantdb/admin": TEMPLATE_INSTANT_VERSION,
          "@instantdb/core": TEMPLATE_INSTANT_VERSION,
        },
      }
    }
  }

  if (params.template === "empty") {
    return {
      ".gitignore": [".next", "node_modules", ".env.local", ".workflow-data"].join("\n"),
      ".env.example": [
        "NEXT_PUBLIC_INSTANT_APP_ID=",
        "INSTANT_ADMIN_TOKEN=",
        "",
        "# Optional: use this only while provisioning new apps with the CLI.",
        "INSTANT_PERSONAL_ACCESS_TOKEN=",
      ].join("\n"),
      "DOMAIN.md": [
        "# Ekairos App Domain",
        "",
        "This app starts empty on purpose.",
        "",
        "Add your first domain in `src/domain.ts`, then expose it through `src/runtime.ts` and `/api/ekairos/domain`.",
        "",
        "Suggested first step:",
        "- create one domain with camelCase name",
        "- name entities as `<domainName>_<entityName>`",
        "- add one `defineAction` for the first business write",
      ].join("\n"),
      "instant.schema.ts": [
        'import appDomain from "./src/domain";',
        "",
        "const schema = appDomain.toInstantSchema();",
        "",
        "export default schema;",
      ].join("\n"),
      "next-env.d.ts": [
        '/// <reference types="next" />',
        '/// <reference types="next/image-types/global" />',
        "",
        "// This file is managed by Next.js.",
      ].join("\n"),
      "next.config.ts": [
        'import type { NextConfig } from "next";',
        'import { withWorkflow } from "workflow/next";',
        "",
        "const nextConfig: NextConfig = {",
        "  transpilePackages: [\"@ekairos/domain\"],",
        "};",
        "",
        "export default withWorkflow(nextConfig) as NextConfig;",
      ].join("\n"),
      "src/app/api/ekairos/domain/route.ts": [
        'import { createRuntimeRouteHandler } from "@ekairos/domain/next";',
        'import { createRuntime } from "@/runtime";',
        "",
        "export const { GET, POST } = createRuntimeRouteHandler({",
        "  createRuntime,",
        "});",
      ].join("\n"),
      "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
      "tsconfig.json": [
        "{",
        '  "compilerOptions": {',
        '    "target": "ES2022",',
        '    "lib": ["dom", "dom.iterable", "es2022"],',
        '    "allowJs": false,',
        '    "skipLibCheck": true,',
        '    "strict": true,',
        '    "noEmit": true,',
        '    "esModuleInterop": true,',
        '    "module": "esnext",',
        '    "moduleResolution": "bundler",',
        '    "resolveJsonModule": true,',
        '    "isolatedModules": true,',
        '    "jsx": "react-jsx",',
        '    "incremental": true,',
        '    "paths": {',
        '      "@/*": ["./src/*"]',
        "    },",
        '    "plugins": [',
        '      { "name": "next" }',
        "    ]",
        "  },",
        '  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],',
        '  "exclude": ["node_modules"]',
        "}",
      ].join("\n"),
      "src/app/globals.css": [
        ":root {",
        "  color-scheme: light;",
        "  --background: #f7f8f6;",
        "  --foreground: #181b18;",
        "  --muted: #626a63;",
        "  --border: #d9ded7;",
        "  --surface: #ffffff;",
        "  --accent: #2f6f5d;",
        "}",
        "",
        "* { box-sizing: border-box; }",
        "html, body { margin: 0; min-height: 100%; }",
        "body { min-height: 100dvh; background: var(--background); color: var(--foreground); font-family: \"Segoe UI\", sans-serif; }",
        "button, input { font: inherit; }",
        "main { width: min(980px, calc(100% - 40px)); margin: 0 auto; padding: 48px 0; }",
        ".shell { display: grid; gap: 24px; }",
        ".eyebrow { color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }",
        "h1 { max-width: 720px; margin: 0; font-size: clamp(2.4rem, 6vw, 4.8rem); letter-spacing: -0.05em; line-height: 0.96; }",
        "p { max-width: 64ch; margin: 0; color: var(--muted); line-height: 1.65; }",
        ".workspace { display: grid; gap: 14px; border: 1px solid var(--border); background: var(--surface); padding: 22px; }",
        ".status-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--border); }",
        ".status-grid div { display: grid; gap: 6px; padding: 14px; border-right: 1px solid var(--border); }",
        ".status-grid div:last-child { border-right: 0; }",
        ".status-grid span { color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }",
        ".status-grid strong { font-size: 1.4rem; }",
        ".next-steps { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }",
        ".next-steps li { border-top: 1px solid var(--border); padding-top: 10px; color: var(--muted); }",
        "code { font-family: \"Cascadia Code\", monospace; }",
        "@media (max-width: 720px) { main { width: min(100% - 28px, 980px); } .status-grid { grid-template-columns: 1fr; } .status-grid div { border-right: 0; border-bottom: 1px solid var(--border); } }",
      ].join("\n"),
      "src/app/layout.tsx": [
        'import "./globals.css";',
        'import type { ReactNode } from "react";',
        "",
        "export const metadata = {",
        '  title: "Ekairos App",',
        '  description: "Scaffolded Ekairos app",',
        "};",
        "",
        "export default function RootLayout({ children }: { children: ReactNode }) {",
        "  return (",
        '    <html lang="en">',
        "      <body>{children}</body>",
        "    </html>",
        "  );",
        "}",
      ].join("\n"),
      "src/app/page.tsx": [
        'import DomainWorkbench from "./domain-workbench";',
        "",
        'export const dynamic = "force-dynamic";',
        "",
        "export default function HomePage() {",
        "  return (",
        "    <main>",
        '      <section className="shell">',
        '        <div className="eyebrow">Ekairos App</div>',
        "        <h1>Empty app. Runtime ready.</h1>",
        "        <p>",
        "          Start here when you want a clean app with the Ekairos runtime,",
        "          domain endpoint, Instant configuration, and a place to add your first domain.",
        "        </p>",
        "        <DomainWorkbench />",
        "      </section>",
        "    </main>",
        "  );",
        "}",
      ].join("\n"),
      "src/app/domain-workbench.tsx": [
        "export default function DomainWorkbench() {",
        "  return (",
        '    <section className="workspace">',
        '      <div className="status-grid">',
        "        <div><span>Runtime</span><strong>Ready</strong></div>",
        "        <div><span>Endpoint</span><strong>/api</strong></div>",
        "        <div><span>Domains</span><strong>0</strong></div>",
        "      </div>",
        "      <p>Add your first domain in <code>src/domain.ts</code>. Keep writes behind typed domain actions.</p>",
        '      <ul className="next-steps">',
        "        <li>Name the domain in camelCase.</li>",
        "        <li>Name entities as <code>{\"<domainName>_<entityName>\"}</code>.</li>",
        "        <li>Expose the first write as a <code>defineAction</code>.</li>",
        "      </ul>",
        "    </section>",
        "  );",
        "}",
      ].join("\n"),
      "src/domain.ts": [
        'import { domain } from "@ekairos/domain";',
        "",
        "const baseDomain = domain(\"app\").withSchema({",
        "  entities: {},",
        "  links: {},",
        "  rooms: {},",
        "});",
        "",
        "export const appDomain = baseDomain.withActions({});",
        "",
        "export default appDomain;",
      ].join("\n"),
      "src/runtime.ts": [
        'import { init } from "@instantdb/admin";',
        'import { EkairosRuntime } from "@ekairos/domain/runtime-handle";',
        'import { configureRuntime } from "@ekairos/domain/runtime";',
        'import appDomain from "./domain";',
        "",
        "export type AppRuntimeEnv = {",
        "  actorEmail?: string | null;",
        "  actorId?: string;",
        "  adminToken?: string;",
        "  appId?: string;",
        "};",
        "",
        "function resolveRuntimeEnv(env: AppRuntimeEnv = {}): Required<Pick<AppRuntimeEnv, \"appId\" | \"adminToken\">> & AppRuntimeEnv {",
        '  const appId = String(env.appId ?? process.env.NEXT_PUBLIC_INSTANT_APP_ID ?? "").trim();',
        '  const adminToken = String(env.adminToken ?? process.env.INSTANT_ADMIN_TOKEN ?? "").trim();',
        "  if (!appId || !adminToken) {",
        '    throw new Error("Missing NEXT_PUBLIC_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN. Copy .env.example to .env.local and fill both values.");',
        "  }",
        "  return { ...env, appId, adminToken };",
        "}",
        "",
        "export class AppRuntime extends EkairosRuntime<AppRuntimeEnv, typeof appDomain, any> {",
        "  protected getDomain() { return appDomain; }",
        "  protected async resolveDb(env: AppRuntimeEnv) {",
        "    const resolved = resolveRuntimeEnv(env);",
        "    return init({",
        "      appId: resolved.appId,",
        "      adminToken: resolved.adminToken,",
        "      schema: appDomain.toInstantSchema(),",
        "      useDateObjects: true,",
        "    } as any) as any;",
        "  }",
        "}",
        "",
        "export function createRuntime(env: AppRuntimeEnv = {}) {",
        "  return new AppRuntime(resolveRuntimeEnv(env));",
        "}",
        "",
        "export const runtimeConfig = configureRuntime<AppRuntimeEnv>({",
        "  runtime: async (env) => {",
        "    const runtime = createRuntime(env);",
        "    return { db: await runtime.db() };",
        "  },",
        "  domain: { domain: appDomain },",
        "});",
      ].join("\n"),
      "src/workflows/demo.workflow.ts": [
        "export type DemoWorkflowInput = Record<string, never>;",
        "",
        "export async function runDemoWorkflow(_input: DemoWorkflowInput) {",
        '  "use workflow";',
        "  return { ok: true };",
        "}",
      ].join("\n"),
    }
  }

  if (params.template === "agent") {
    return {
      ".gitignore": [".next", "node_modules", ".env.local", ".workflow-data"].join("\n"),
      ".env.example": [
        "NEXT_PUBLIC_INSTANT_APP_ID=",
        "INSTANT_ADMIN_TOKEN=",
        "",
        "# Optional: use this only while provisioning new apps with the CLI.",
        "INSTANT_PERSONAL_ACCESS_TOKEN=",
      ].join("\n"),
      "DOMAIN.md": [
        "# Ekairos Agent Template",
        "",
        "This app is the minimal loop for Ekairos event contexts:",
        "",
        "1. create the app",
        "2. start an agent context through `/api/agent/react`",
        "3. open the Instant app in Workbench v2",
        "4. iterate on `src/agent.ts`",
        "",
        "The scaffold uses the canonical `@ekairos/events` schema so Workbench v2 can inspect `event_contexts`.",
        "It includes an Ekairos registry alias so domain UI components can be installed with shadcn and use `@ekairos/events` directly.",
      ].join("\n"),
      "components.json": [
        "{",
        '  "$schema": "https://ui.shadcn.com/schema.json",',
        '  "style": "default",',
        '  "rsc": false,',
        '  "tsx": true,',
        '  "tailwind": {',
        '    "config": "",',
        '    "css": "src/app/globals.css",',
        '    "baseColor": "zinc",',
        '    "cssVariables": true,',
        '    "prefix": ""',
        "  },",
        '  "iconLibrary": "lucide",',
        '  "aliases": {',
        '    "components": "@/components",',
        '    "utils": "@/lib/utils",',
        '    "ui": "@/components/ui",',
        '    "lib": "@/lib",',
        '    "hooks": "@/hooks"',
        "  },",
        '  "registries": {',
        '    "@ekairos": "https://registry.ekairos.dev/r/{name}.json"',
        "  }",
        "}",
      ].join("\n"),
      "instant.schema.ts": [
        'import { eventsDomain } from "@ekairos/events/schema";',
        "",
        "const schema = eventsDomain.toInstantSchema();",
        "",
        "export default schema;",
      ].join("\n"),
      "next-env.d.ts": [
        '/// <reference types="next" />',
        '/// <reference types="next/image-types/global" />',
        "",
        "// This file is managed by Next.js.",
      ].join("\n"),
      "next.config.ts": [
        'import type { NextConfig } from "next";',
        'import { withWorkflow } from "workflow/next";',
        "",
        "const nextConfig: NextConfig = {",
        "  transpilePackages: [\"@ekairos/domain\", \"@ekairos/events\"],",
        "};",
        "",
        "export default withWorkflow(nextConfig) as NextConfig;",
      ].join("\n"),
      "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
      "tsconfig.json": [
        "{",
        '  "compilerOptions": {',
        '    "target": "ES2022",',
        '    "lib": ["dom", "dom.iterable", "es2022"],',
        '    "allowJs": false,',
        '    "skipLibCheck": true,',
        '    "strict": true,',
        '    "noEmit": true,',
        '    "esModuleInterop": true,',
        '    "module": "esnext",',
        '    "moduleResolution": "bundler",',
        '    "resolveJsonModule": true,',
        '    "isolatedModules": true,',
        '    "jsx": "react-jsx",',
        '    "incremental": true,',
        '    "paths": {',
        '      "@/*": ["./src/*"]',
        "    },",
        '    "plugins": [',
        '      { "name": "next" }',
        "    ]",
        "  },",
        '  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],',
        '  "exclude": ["node_modules"]',
        "}",
      ].join("\n"),
      "src/app/globals.css": [
        ":root {",
        "  color-scheme: light;",
        "  --background: #f7f8f6;",
        "  --foreground: #171a18;",
        "  --muted: #626a63;",
        "  --border: #d9ded7;",
        "  --surface: #ffffff;",
        "  --accent: #26715f;",
        "}",
        "* { box-sizing: border-box; }",
        "html, body { margin: 0; min-height: 100%; }",
        "body { min-height: 100dvh; background: var(--background); color: var(--foreground); font-family: \"Segoe UI\", sans-serif; }",
        "button, textarea, input { font: inherit; }",
        "main { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 44px 0; }",
        ".shell { display: grid; gap: 22px; }",
        ".eyebrow { color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }",
        "h1 { max-width: 760px; margin: 0; font-size: clamp(2.1rem, 5vw, 4.4rem); line-height: 1; }",
        "p { max-width: 68ch; margin: 0; color: var(--muted); line-height: 1.65; }",
        ".panel { display: grid; gap: 16px; border: 1px solid var(--border); background: var(--surface); padding: 20px; }",
        ".grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--border); }",
        ".grid div { display: grid; gap: 6px; padding: 14px; border-right: 1px solid var(--border); }",
        ".grid div:last-child { border-right: 0; }",
        ".grid span { color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }",
        ".grid strong { font-size: 1rem; overflow-wrap: anywhere; }",
        "textarea { width: 100%; min-height: 120px; resize: vertical; border: 1px solid var(--border); padding: 12px; }",
        "button { width: fit-content; border: 0; background: var(--accent); color: white; padding: 10px 14px; font-weight: 700; cursor: pointer; }",
        "button:disabled { cursor: wait; opacity: 0.65; }",
        "pre { overflow: auto; margin: 0; border: 1px solid var(--border); background: #f2f4f1; padding: 14px; }",
        "code { font-family: \"Cascadia Code\", monospace; }",
        "@media (max-width: 720px) { .grid { grid-template-columns: 1fr; } .grid div { border-right: 0; border-bottom: 1px solid var(--border); } }",
      ].join("\n"),
      "src/app/layout.tsx": [
        'import "./globals.css";',
        'import type { ReactNode } from "react";',
        "",
        "export const metadata = {",
        '  title: "Ekairos Agent",',
        '  description: "Scaffolded Ekairos agent context app",',
        "};",
        "",
        "export default function RootLayout({ children }: { children: ReactNode }) {",
        "  return (",
        '    <html lang="en">',
        "      <body>{children}</body>",
        "    </html>",
        "  );",
        "}",
      ].join("\n"),
      "src/app/page.tsx": [
        'import AgentWorkbench from "./agent-workbench";',
        "",
        'export const dynamic = "force-dynamic";',
        "",
        "export default function HomePage() {",
        "  return (",
        "    <main>",
        '      <section className="shell">',
        '        <div className="eyebrow">Ekairos Agent Template</div>',
        "        <h1>Start a context, inspect it in Workbench v2, iterate.</h1>",
        "        <p>",
        "          This template writes canonical @ekairos/events rows and returns the context id immediately.",
        "        </p>",
        "        <AgentWorkbench />",
        "      </section>",
        "    </main>",
        "  );",
        "}",
      ].join("\n"),
      "src/app/agent-workbench.tsx": [
        '"use client";',
        "",
        "import { useMemo, useState } from \"react\";",
        "",
        "type AgentResult = {",
        "  ok: boolean;",
        "  appId?: string;",
        "  contextId?: string;",
        "  contextKey?: string | null;",
        "  triggerEventId?: string;",
        "  error?: string;",
        "};",
        "",
        "export default function AgentWorkbench() {",
        "  const [prompt, setPrompt] = useState(\"Create a deterministic template context.\");",
        "  const [result, setResult] = useState<AgentResult | null>(null);",
        "  const [pending, setPending] = useState(false);",
        "",
        "  const workbenchPath = useMemo(() => {",
        "    if (!result?.appId || !result?.contextId) return \"\";",
        "    return `/app/${result.appId}/contexts/${result.contextId}`;",
        "  }, [result]);",
        "",
        "  async function startContext() {",
        "    setPending(true);",
        "    setResult(null);",
        "    try {",
        "      const response = await fetch(\"/api/agent/react\", {",
        "        method: \"POST\",",
        "        headers: { \"content-type\": \"application/json\" },",
        "        body: JSON.stringify({ prompt }),",
        "      });",
        "      const data = (await response.json().catch(() => ({}))) as AgentResult;",
        "      setResult(response.ok ? data : { ok: false, error: data.error || response.statusText });",
        "    } catch (error) {",
        "      setResult({ ok: false, error: error instanceof Error ? error.message : String(error) });",
        "    } finally {",
        "      setPending(false);",
        "    }",
        "  }",
        "",
        "  return (",
        '    <section className="panel">',
        '      <div className="grid">',
        "        <div><span>Schema</span><strong>@ekairos/events</strong></div>",
        "        <div><span>Route</span><strong>/api/agent/react</strong></div>",
        "        <div><span>Mode</span><strong>scripted reactor</strong></div>",
        "      </div>",
        "      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />",
        "      <button type=\"button\" disabled={pending} onClick={startContext}>",
        "        {pending ? \"Starting context...\" : \"Start context\"}",
        "      </button>",
        "      {workbenchPath ? <p>Workbench v2 path: <code>{workbenchPath}</code></p> : null}",
        "      {result ? <pre>{JSON.stringify(result, null, 2)}</pre> : null}",
        "    </section>",
        "  );",
        "}",
      ].join("\n"),
      "src/app/api/agent/react/route.ts": [
        'import { NextRequest, NextResponse } from "next/server";',
        'import { agentContext, createTriggerEvent } from "@/agent";',
        'import { createRuntime } from "@/runtime";',
        "",
        "export const maxDuration = 60;",
        "",
        "function readTrimmed(value: unknown) {",
        "  return typeof value === \"string\" ? value.trim() : \"\";",
        "}",
        "",
        "export async function POST(req: NextRequest) {",
        "  try {",
        "    const body = await req.json().catch(() => ({}));",
        "    const prompt = readTrimmed((body as any).prompt) || \"Create a deterministic template context.\";",
        "    const contextKey = readTrimmed((body as any).contextKey) || `agent-template:${Date.now()}`;",
        "    const triggerEvent = createTriggerEvent(prompt);",
        "    const reaction = await agentContext.react(triggerEvent, {",
        "      runtime: createRuntime({ actorId: \"template-user\" }),",
        "      context: { key: contextKey },",
        "      durable: false,",
        "    });",
        "    if (reaction.run) await reaction.run;",
        "    return NextResponse.json({",
        "      ok: true,",
        "      appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID || null,",
        "      contextId: String(reaction.context.id || \"\"),",
        "      contextKey: reaction.context.key ?? contextKey,",
        "      triggerEventId: triggerEvent.id,",
        "    });",
        "  } catch (error) {",
        "    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });",
        "  }",
        "}",
      ].join("\n"),
      "src/agent.ts": [
        "import {",
        "  createContext,",
        "  createScriptedReactor,",
        "  defineAction,",
        "  eventsDomain,",
        "  type ContextItem,",
        "} from \"@ekairos/events\";",
        "import { z } from \"zod\";",
        "",
        "export type AgentEnv = {",
        "  actorId?: string;",
        "};",
        "",
        "const createMessageInput = z.object({",
        "  message: z.string(),",
        "  marker: z.string().optional(),",
        "});",
        "",
        "const createMessageOutput = z.object({",
        "  message: z.string(),",
        "  marker: z.string(),",
        "});",
        "",
        "async function createMessage(input: z.infer<typeof createMessageInput>) {",
        "  \"use step\";",
        "  return {",
        "    message: input.message,",
        "    marker: input.marker ?? \"AGENT_TEMPLATE_OK\",",
        "  };",
        "}",
        "",
        "function randomId() {",
        "  return globalThis.crypto?.randomUUID?.() ?? `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`;",
        "}",
        "",
        "export function createTriggerEvent(text: string): ContextItem {",
        "  return {",
        "    id: randomId(),",
        "    type: \"user_message_created\",",
        "    channel: \"web\",",
        "    createdAt: new Date().toISOString(),",
        "    content: { parts: [{ type: \"text\", text }] },",
        "  } as any;",
        "}",
        "",
        "export const agentContext = createContext<AgentEnv>(\"agent.template\")",
        "  .context((stored, env) => ({ ...(stored.content ?? {}), actorId: env.actorId ?? null }))",
        "  .narrative(() => \"You are the minimal Ekairos agent template. Create one deterministic message.\")",
        "  .actions(() => ({",
        "    createMessage: defineAction<any, any, Record<string, never>, AgentEnv, typeof eventsDomain>({",
        "      description: \"Create the deterministic template message.\",",
        "      input: createMessageInput as any,",
        "      output: createMessageOutput as any,",
        "      execute: async ({ input }) => await createMessage(input),",
        "    }),",
        "  }))",
        "  .reactor(",
        "    createScriptedReactor({",
        "      steps: [",
        "        {",
        "          assistantEvent: {",
        "            content: {",
        "              parts: [",
        "                { type: \"text\", text: \"AGENT_TEMPLATE_OK context ready.\" },",
        "                {",
        "                  type: \"tool-createMessage\",",
        "                  toolCallId: \"agent-template-create-message\",",
        "                  input: { message: \"AGENT_TEMPLATE_OK context ready.\", marker: \"AGENT_TEMPLATE_OK\" },",
        "                },",
        "              ],",
        "            },",
        "          },",
        "          actionRequests: [",
        "            {",
        "              actionRef: \"agent-template-create-message\",",
        "              actionName: \"createMessage\",",
        "              input: { message: \"AGENT_TEMPLATE_OK context ready.\", marker: \"AGENT_TEMPLATE_OK\" },",
        "            },",
        "          ],",
        "          messagesForModel: [],",
        "          llm: { provider: \"scripted\", model: \"agent-template\" },",
        "        },",
        "      ],",
        "      repeatLast: true,",
        "    }),",
        "  )",
        "  .shouldContinue(() => false)",
        "  .build();",
      ].join("\n"),
      "src/runtime.ts": [
        'import { init } from "@instantdb/admin";',
        'import { EkairosRuntime } from "@ekairos/domain/runtime-handle";',
        'import { eventsDomain } from "@ekairos/events/schema";',
        "",
        "export type AgentRuntimeEnv = {",
        "  actorId?: string | null;",
        "  adminToken?: string;",
        "  appId?: string;",
        "};",
        "",
        "function resolveRuntimeEnv(env: AgentRuntimeEnv = {}): Required<Pick<AgentRuntimeEnv, \"appId\" | \"adminToken\">> & AgentRuntimeEnv {",
        "  const appId = String(env.appId ?? process.env.NEXT_PUBLIC_INSTANT_APP_ID ?? \"\").trim();",
        "  const adminToken = String(env.adminToken ?? process.env.INSTANT_ADMIN_TOKEN ?? \"\").trim();",
        "  if (!appId || !adminToken) {",
        "    throw new Error(\"Missing NEXT_PUBLIC_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN. Copy .env.example to .env.local and fill both values.\");",
        "  }",
        "  return { ...env, appId, adminToken };",
        "}",
        "",
        "export class AgentRuntime extends EkairosRuntime<AgentRuntimeEnv, typeof eventsDomain, any> {",
        "  protected getDomain() { return eventsDomain; }",
        "  protected async resolveDb(env: AgentRuntimeEnv) {",
        "    const resolved = resolveRuntimeEnv(env);",
        "    return init({",
        "      appId: resolved.appId,",
        "      adminToken: resolved.adminToken,",
        "      schema: eventsDomain.toInstantSchema(),",
        "      useDateObjects: true,",
        "    } as any) as any;",
        "  }",
        "}",
        "",
        "export function createRuntime(env: AgentRuntimeEnv = {}) {",
        "  return new AgentRuntime(resolveRuntimeEnv(env));",
        "}",
      ].join("\n"),
    }
  }

  return {
    ".gitignore": [".next", "node_modules", ".env.local", ".workflow-data"].join("\n"),
    ".env.example": [
      "NEXT_PUBLIC_INSTANT_APP_ID=",
      "INSTANT_ADMIN_TOKEN=",
      "",
      "# Optional: use this only while provisioning new apps with the CLI.",
      "INSTANT_PERSONAL_ACCESS_TOKEN=",
    ].join("\n"),
    "DOMAIN.md": [
      "# Ekairos Supply Chain Domain",
      "",
      "This scaffold ships a supply-chain control tower backed by separate domains:",
      "- `supplierNetwork` owns supplier risk and score",
      "- `procurement` owns purchase orders",
      "- `inventory` owns stock position",
      "- `transportation` owns shipments and ETA",
      "- `qualityControl` owns arrival inspection",
      "",
      "Actions:",
      "- `launchOrder` -> creates and links supplier, order, stock, shipment, and inspection",
      "- `expediteShipment` -> updates shipment status and ETA",
    ].join("\n"),
    "instant.schema.ts": [
      'import appDomain from "./src/domain";',
      "",
      "const schema = appDomain.toInstantSchema();",
      "",
      "export default schema;",
    ].join("\n"),
    "next-env.d.ts": [
      '/// <reference types="next" />',
      '/// <reference types="next/image-types/global" />',
      "",
      "// This file is managed by Next.js.",
    ].join("\n"),
    "next.config.ts": [
      'import type { NextConfig } from "next";',
      'import { withWorkflow } from "workflow/next";',
      "",
      "const nextConfig: NextConfig = {",
      "  transpilePackages: [\"@ekairos/domain\"],",
      "};",
      "",
      "export default withWorkflow(nextConfig) as NextConfig;",
    ].join("\n"),
    "src/app/api/ekairos/domain/route.ts": [
      'import { createRuntimeRouteHandler } from "@ekairos/domain/next";',
      'import { createRuntime } from "@/runtime";',
      "",
      "export const { GET, POST } = createRuntimeRouteHandler({",
      "  createRuntime,",
      "});",
    ].join("\n"),
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
    "tsconfig.json": [
      "{",
      '  "compilerOptions": {',
      '    "target": "ES2022",',
      '    "lib": ["dom", "dom.iterable", "es2022"],',
      '    "allowJs": false,',
      '    "skipLibCheck": true,',
      '    "strict": true,',
      '    "noEmit": true,',
      '    "esModuleInterop": true,',
      '    "module": "esnext",',
      '    "moduleResolution": "bundler",',
      '    "resolveJsonModule": true,',
      '    "isolatedModules": true,',
      '    "jsx": "react-jsx",',
      '    "incremental": true,',
      '    "paths": {',
      '      "@/*": ["./src/*"]',
      "    },",
      '    "plugins": [',
      '      { "name": "next" }',
      "    ]",
      "  },",
      '  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],',
      '  "exclude": ["node_modules"]',
      "}",
    ].join("\n"),
    "src/app/globals.css": [
      ":root {",
      "  color-scheme: light;",
      "  --bg: #f7f8f6;",
      "  --surface: #ffffff;",
      "  --surface-2: #f0f2ef;",
      "  --ink: #171a18;",
      "  --muted: #646b66;",
      "  --accent: #26715f;",
      "  --accent-soft: #dfece7;",
      "  --border: #d9ded9;",
      "  --line: #b9c1ba;",
      "  --danger: #9f2f28;",
      "}",
      "",
      "* {",
      "  box-sizing: border-box;",
      "}",
      "",
      "html,",
      "body {",
      "  margin: 0;",
      "  min-height: 100%;",
      "  background: var(--bg);",
      "  color: var(--ink);",
      "  font-family: \"Geist\", \"Aptos\", \"Segoe UI\", sans-serif;",
      "}",
      "",
      "body {",
      "  min-height: 100dvh;",
      "}",
      "",
      "button,",
      "input {",
      "  font: inherit;",
      "}",
      "",
      "main {",
      "  width: min(1240px, calc(100% - 40px));",
      "  margin: 0 auto;",
      "  padding: 44px 0 64px;",
      "}",
      "",
      ".hero {",
      "  display: grid;",
      "  gap: 14px;",
      "  max-width: 720px;",
      "  margin-bottom: 28px;",
      "}",
      "",
      ".eyebrow {",
      "  color: var(--accent);",
      "  font-size: 11px;",
      "  font-weight: 800;",
      "  letter-spacing: 0.16em;",
      "  text-transform: uppercase;",
      "}",
      "",
      "h1,",
      "h2 {",
      "  margin: 0;",
      "  letter-spacing: -0.04em;",
      "}",
      "",
      "h1 {",
      "  max-width: 640px;",
      "  font-size: clamp(2.4rem, 5.4vw, 4.8rem);",
      "  line-height: 0.96;",
      "}",
      "",
      "h2 {",
      "  font-size: 1.28rem;",
      "  line-height: 1.05;",
      "}",
      "",
      "p {",
      "  margin: 0;",
      "  color: var(--muted);",
      "  line-height: 1.6;",
      "}",
      "",
      ".shell {",
      "  display: grid;",
      "  gap: 14px;",
      "}",
      "",
      ".metrics-strip {",
      "  display: grid;",
      "  grid-template-columns: repeat(4, minmax(0, 1fr));",
      "  border: 1px solid var(--border);",
      "  background: var(--surface);",
      "}",
      "",
      ".metrics-strip div {",
      "  display: grid;",
      "  gap: 6px;",
      "  padding: 16px;",
      "  border-right: 1px solid var(--border);",
      "}",
      "",
      ".metrics-strip div:last-child {",
      "  border-right: 0;",
      "}",
      "",
      ".metrics-strip span,",
      ".manifest-label {",
      "  color: var(--muted);",
      "  font-size: 11px;",
      "  font-weight: 800;",
      "  letter-spacing: 0.12em;",
      "  text-transform: uppercase;",
      "}",
      "",
      ".metrics-strip strong {",
      "  font-size: 1.85rem;",
      "  letter-spacing: -0.04em;",
      "  line-height: 1;",
      "}",
      "",
      ".workbench {",
      "  display: grid;",
      "  grid-template-columns: 0.8fr 1fr;",
      "  gap: 14px;",
      "  align-items: start;",
      "}",
      "",
      ".context-rail,",
      ".command-panel,",
      ".graph-panel {",
      "  border: 1px solid var(--border);",
      "  background: var(--surface);",
      "}",
      "",
      ".context-rail,",
      ".command-panel {",
      "  padding: 18px;",
      "}",
      "",
      ".graph-panel {",
      "  grid-column: 1 / -1;",
      "  padding: 18px;",
      "}",
      "",
      ".panel-head {",
      "  display: flex;",
      "  justify-content: space-between;",
      "  gap: 16px;",
      "  align-items: start;",
      "  margin-bottom: 16px;",
      "}",
      "",
      ".context-list,",
      ".project-list,",
      ".task-lines,",
      ".lane-grid,",
      ".calls-feed,",
      ".button-row {",
      "  display: grid;",
      "  gap: 10px;",
      "}",
      "",
      ".context-row {",
      "  display: grid;",
      "  grid-template-columns: 0.7fr 1fr;",
      "  gap: 14px;",
      "  padding: 12px 0;",
      "  border-top: 1px solid var(--border);",
      "  opacity: 0;",
      "  transform: translateY(8px);",
      "  animation: lift-in 420ms cubic-bezier(0.16, 1, 0.3, 1) forwards;",
      "  animation-delay: calc(var(--index) * 70ms);",
      "}",
      "",
      ".context-row span {",
      "  font-weight: 800;",
      "}",
      "",
      ".context-row strong {",
      "  color: var(--muted);",
      "  font-size: 0.92rem;",
      "  font-weight: 500;",
      "}",
      "",
      ".field {",
      "  display: grid;",
      "  gap: 7px;",
      "  margin: 14px 0;",
      "}",
      "",
      ".field span {",
      "  color: var(--muted);",
      "  font-size: 0.85rem;",
      "  font-weight: 700;",
      "}",
      "",
      ".input {",
      "  width: 100%;",
      "  border: 1px solid var(--border);",
      "  border-radius: 6px;",
      "  padding: 12px 13px;",
      "  background: var(--surface-2);",
      "  color: var(--ink);",
      "  outline: none;",
      "}",
      "",
      ".input:focus {",
      "  border-color: var(--accent);",
      "  background: var(--surface);",
      "}",
      "",
      ".button-row {",
      "  grid-template-columns: repeat(2, minmax(0, 1fr));",
      "  margin-top: 16px;",
      "}",
      "",
      ".button {",
      "  appearance: none;",
      "  border: 1px solid var(--ink);",
      "  border-radius: 6px;",
      "  padding: 12px 14px;",
      "  background: var(--ink);",
      "  color: #ffffff;",
      "  cursor: pointer;",
      "  font-weight: 800;",
      "  transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1), opacity 160ms ease;",
      "}",
      "",
      ".button:hover:not(:disabled) {",
      "  transform: translateY(-1px);",
      "}",
      "",
      ".button:active:not(:disabled) {",
      "  transform: translateY(1px) scale(0.99);",
      "}",
      "",
      ".button:disabled {",
      "  cursor: wait;",
      "  opacity: 0.62;",
      "}",
      "",
      ".button.ghost {",
      "  border-color: var(--border);",
      "  background: var(--surface);",
      "  color: var(--ink);",
      "}",
      "",
      ".status-pill {",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  min-width: 86px;",
      "  padding: 7px 10px;",
      "  border-radius: 6px;",
      "  background: var(--accent-soft);",
      "  color: var(--accent);",
      "  font-size: 11px;",
      "  font-weight: 800;",
      "  letter-spacing: 0.08em;",
      "  text-transform: uppercase;",
      "}",
      "",
      ".project-row {",
      "  display: grid;",
      "  grid-template-columns: 1fr auto;",
      "  gap: 14px;",
      "  padding: 16px 0;",
      "  border-top: 1px solid var(--border);",
      "}",
      "",
      ".project-row:first-child {",
      "  border-top: 0;",
      "}",
      "",
      ".project-row strong {",
      "  display: block;",
      "  font-size: 1.05rem;",
      "}",
      "",
      ".project-row span {",
      "  color: var(--muted);",
      "}",
      "",
      ".project-meta {",
      "  display: flex;",
      "  flex-wrap: wrap;",
      "  gap: 8px;",
      "  justify-content: flex-end;",
      "}",
      "",
      ".project-meta span {",
      "  border: 1px solid var(--border);",
      "  border-radius: 6px;",
      "  padding: 5px 8px;",
      "  color: var(--ink);",
      "  font-size: 0.82rem;",
      "  font-weight: 700;",
      "}",
      "",
      ".task-lines {",
      "  grid-column: 1 / -1;",
      "  padding-top: 2px;",
      "}",
      "",
      ".task-lines p {",
      "  display: grid;",
      "  grid-template-columns: minmax(180px, 0.8fr) minmax(180px, 1fr);",
      "  gap: 12px;",
      "  padding-left: 14px;",
      "  border-left: 2px solid var(--line);",
      "}",
      "",
      ".task-lines b {",
      "  color: var(--ink);",
      "}",
      "",
      ".task-lines em {",
      "  grid-column: 1 / -1;",
      "  color: var(--muted);",
      "  font-style: normal;",
      "}",
      "",
      ".raid-summary {",
      "  display: grid;",
      "  grid-template-columns: repeat(3, minmax(0, 1fr));",
      "  border: 1px solid var(--border);",
      "  margin-bottom: 14px;",
      "}",
      "",
      ".raid-summary div {",
      "  display: grid;",
      "  gap: 6px;",
      "  padding: 13px;",
      "  border-right: 1px solid var(--border);",
      "}",
      "",
      ".raid-summary div:last-child {",
      "  border-right: 0;",
      "}",
      "",
      ".raid-summary span {",
      "  color: var(--muted);",
      "  font-size: 11px;",
      "  font-weight: 800;",
      "  letter-spacing: 0.12em;",
      "  text-transform: uppercase;",
      "}",
      "",
      ".raid-summary strong {",
      "  font-size: 1rem;",
      "}",
      "",
      ".lane-grid {",
      "  grid-template-columns: repeat(3, minmax(0, 1fr));",
      "}",
      "",
      ".lane {",
      "  min-height: 180px;",
      "  border: 1px solid var(--border);",
      "  padding: 12px;",
      "  background: var(--surface-2);",
      "}",
      "",
      ".objective {",
      "  display: grid;",
      "  gap: 5px;",
      "  margin-top: 10px;",
      "  padding: 10px;",
      "  border: 1px solid var(--border);",
      "  background: var(--surface);",
      "}",
      "",
      ".objective span,",
      ".objective em {",
      "  color: var(--muted);",
      "  font-size: 0.88rem;",
      "  font-style: normal;",
      "}",
      "",
      ".calls-feed {",
      "  margin-top: 14px;",
      "  padding-top: 14px;",
      "  border-top: 1px solid var(--border);",
      "}",
      "",
      ".calls-feed p {",
      "  display: flex;",
      "  justify-content: space-between;",
      "  gap: 16px;",
      "}",
      "",
      ".calls-feed b {",
      "  color: var(--ink);",
      "}",
      "",
      ".muted {",
      "  color: var(--muted);",
      "}",
      "",
      ".empty-state,",
      ".error-banner {",
      "  border: 1px solid var(--border);",
      "  border-radius: 6px;",
      "  padding: 14px;",
      "}",
      "",
      ".empty-state {",
      "  background: var(--surface-2);",
      "  color: var(--muted);",
      "}",
      "",
      ".error-banner {",
      "  background: #fff4f2;",
      "  color: var(--danger);",
      "  border-color: #efc4bd;",
      "}",
      "",
      ".skeleton-stack {",
      "  display: grid;",
      "  gap: 10px;",
      "}",
      "",
      ".skeleton-stack span {",
      "  display: block;",
      "  height: 54px;",
      "  border-radius: 6px;",
      "  background: linear-gradient(90deg, var(--surface-2), #ffffff, var(--surface-2));",
      "  background-size: 220% 100%;",
      "  animation: shimmer 1.2s ease-in-out infinite;",
      "}",
      "",
      "pre {",
      "  overflow: auto;",
      "  margin-top: 14px;",
      "  border-radius: 6px;",
      "  padding: 12px;",
      "  background: #1d211f;",
      "  color: #eef5f1;",
      "  font-size: 12px;",
      "  line-height: 1.45;",
      "}",
      "",
      "code {",
      "  font-family: \"Geist Mono\", \"Cascadia Code\", monospace;",
      "}",
      "",
      "@keyframes lift-in {",
      "  to {",
      "    opacity: 1;",
      "    transform: translateY(0);",
      "  }",
      "}",
      "",
      "@keyframes shimmer {",
      "  to {",
      "    background-position: -220% 0;",
      "  }",
      "}",
      "",
      "@media (max-width: 820px) {",
      "  main {",
      "    width: min(100% - 28px, 1240px);",
      "    padding: 32px 0 52px;",
      "  }",
      "",
      "  .metrics-strip,",
      "  .workbench,",
      "  .button-row,",
      "  .raid-summary,",
      "  .lane-grid,",
      "  .project-row,",
      "  .task-lines p {",
      "    grid-template-columns: 1fr;",
      "  }",
      "",
      "  .metrics-strip div {",
      "    border-right: 0;",
      "    border-bottom: 1px solid var(--border);",
      "  }",
      "",
      "  .metrics-strip div:last-child {",
      "    border-bottom: 0;",
      "  }",
      "",
      "  .project-meta {",
      "    justify-content: flex-start;",
      "  }",
      "",
      "  .raid-summary div {",
      "    border-right: 0;",
      "    border-bottom: 1px solid var(--border);",
      "  }",
      "",
      "  .raid-summary div:last-child {",
      "    border-bottom: 0;",
      "  }",
      "}",
    ].join("\n"),
    "src/app/layout.tsx": [
      'import "./globals.css";',
      'import type { ReactNode } from "react";',
      "",
      "export const metadata = {",
      '  title: "Ekairos App",',
      '  description: "Scaffolded Ekairos domain app",',
      "};",
      "",
      "export default function RootLayout({ children }: { children: ReactNode }) {",
      "  return (",
      '    <html lang="en">',
      "      <body>{children}</body>",
      "    </html>",
      "  );",
      "}",
    ].join("\n"),
    "src/app/page.tsx": [
      "import DomainShowcase from \"./domain-showcase\";",
      "",
      "export const dynamic = \"force-dynamic\";",
      "",
      "export default function HomePage() {",
      "  return (",
      "    <main>",
      "      <section className=\"hero\">",
      "        <div className=\"eyebrow\">Ekairos Domain Scaffold</div>",
      "        <h1>Supply chain control tower.</h1>",
      "        <p>",
      "          Open an order, track stock, shipment, supplier risk, and quality status in one live view.",
      "        </p>",
      "      </section>",
      "",
      "      <DomainShowcase />",
      "    </main>",
      "  );",
      "}",
    ].join("\n"),
    "src/app/domain-showcase.tsx": [
      "\"use client\";",
      "",
      "import { useMemo, useState } from \"react\";",
      "import { init } from \"@instantdb/react\";",
      "",
      "type SupplierRow = {",
      "  id?: string;",
      "  name?: string;",
      "  region?: string;",
      "  risk?: string;",
      "  score?: number;",
      "};",
      "",
      "type StockItemRow = {",
      "  id?: string;",
      "  sku?: string;",
      "  warehouse?: string;",
      "  available?: number;",
      "  safetyStock?: number;",
      "};",
      "",
      "type InspectionRow = {",
      "  id?: string;",
      "  result?: string;",
      "  severity?: string;",
      "  note?: string;",
      "};",
      "",
      "type ShipmentRow = {",
      "  id?: string;",
      "  carrier?: string;",
      "  lane?: string;",
      "  status?: string;",
      "  etaHours?: number;",
      "  inspections?: InspectionRow[] | InspectionRow;",
      "};",
      "",
      "type OrderRow = {",
      "  id?: string;",
      "  reference?: string;",
      "  status?: string;",
      "  spend?: number;",
      "  supplier?: SupplierRow | SupplierRow[];",
      "  stockItems?: StockItemRow[] | StockItemRow;",
      "  shipments?: ShipmentRow[] | ShipmentRow;",
      "};",
      "",
      "const db = init({",
      "  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID || \"\",",
      "});",
      "",
      "function asArray<T>(value: T | T[] | null | undefined): T[] {",
      "  if (!value) return [];",
      "  return Array.isArray(value) ? value : [value];",
      "}",
      "",
      "function first<T>(value: T | T[] | null | undefined): T | null {",
      "  return asArray(value)[0] ?? null;",
      "}",
      "",
      "function money(value?: number) {",
      "  return new Intl.NumberFormat(undefined, {",
      "    currency: \"USD\",",
      "    maximumFractionDigits: 0,",
      "    style: \"currency\",",
      "  }).format(value ?? 0);",
      "}",
      "",
      "async function runAction(action: string, input: Record<string, unknown>) {",
      "  const response = await fetch(\"/api/ekairos/domain\", {",
      "    method: \"POST\",",
      "    headers: { \"content-type\": \"application/json\" },",
      "    body: JSON.stringify({ op: \"action\", action, input }),",
      "  });",
      "  const text = await response.text();",
      "  if (!response.ok) throw new Error(text || `request_failed:${response.status}`);",
      "  return text ? JSON.parse(text) : null;",
      "}",
      "",
      "export default function DomainShowcase() {",
      "  const [reference, setReference] = useState(\"PO-7842\");",
      "  const [supplierName, setSupplierName] = useState(\"Marula Components\");",
      "  const [sku, setSku] = useState(\"DRV-2048\");",
      "  const [loadingAction, setLoadingAction] = useState<string | null>(null);",
      "  const [actionError, setActionError] = useState<string | null>(null);",
      "",
      "  const query = db.useQuery({",
      "    procurement_order: {",
      "      $: { order: { createdAt: \"desc\" }, limit: 8 },",
      "      supplier: {},",
      "      stockItems: {},",
      "      shipments: {",
      "        inspections: {},",
      "      },",
      "    },",
      "  }) as {",
      "    data?: { procurement_order?: OrderRow[] };",
      "    error?: unknown;",
      "    isLoading: boolean;",
      "  };",
      "",
      "  const orders = query.data?.procurement_order ?? [];",
      "  const activeOrder = orders[0] ?? null;",
      "  const supplier = first(activeOrder?.supplier);",
      "  const stockItems = asArray(activeOrder?.stockItems);",
      "  const shipments = asArray(activeOrder?.shipments);",
      "  const shipment = shipments[0] ?? null;",
      "  const inspections = shipments.flatMap((entry) => asArray(entry.inspections));",
      "  const inspection = inspections[0] ?? null;",
      "",
      "  const metrics = useMemo(() => ({",
      "    orders: orders.length,",
      "    stock: stockItems.reduce((total, item) => total + (item.available ?? 0), 0),",
      "    eta: shipment?.etaHours ?? 0,",
      "    risk: supplier?.risk ?? \"none\",",
      "  }), [orders.length, shipment?.etaHours, stockItems, supplier?.risk]);",
      "",
      "  async function submitAction(action: string, input: Record<string, unknown>) {",
      "    setLoadingAction(action);",
      "    setActionError(null);",
      "    try {",
      "      await runAction(action, input);",
      "    } catch (error) {",
      "      setActionError(error instanceof Error ? error.message : String(error));",
      "    } finally {",
      "      setLoadingAction(null);",
      "    }",
      "  }",
      "",
      "  return (",
      "    <section className=\"shell\">",
      "      <div className=\"metrics-strip\">",
      "        <div><span>open orders</span><strong>{metrics.orders}</strong></div>",
      "        <div><span>available stock</span><strong>{metrics.stock}</strong></div>",
      "        <div><span>shipment eta</span><strong>{metrics.eta}h</strong></div>",
      "        <div><span>supplier risk</span><strong>{metrics.risk}</strong></div>",
      "      </div>",
      "",
      "      <div className=\"workbench\">",
      "        <section className=\"command-panel\">",
      "          <span className=\"eyebrow\">Release</span>",
      "          <h2>Open a purchase order</h2>",
      "          <label className=\"field\">",
      "            <span>PO reference</span>",
      "            <input className=\"input\" value={reference} onChange={(event) => setReference(event.target.value)} />",
      "          </label>",
      "          <label className=\"field\">",
      "            <span>Supplier</span>",
      "            <input className=\"input\" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />",
      "          </label>",
      "          <label className=\"field\">",
      "            <span>SKU</span>",
      "            <input className=\"input\" value={sku} onChange={(event) => setSku(event.target.value)} />",
      "          </label>",
      "          <div className=\"button-row\">",
      "            <button",
      "              className=\"button\"",
      "              disabled={loadingAction !== null}",
      "              onClick={() => void submitAction(\"supplyChain.order.launch\", { reference, sku, supplierName })}",
      "            >",
      "              {loadingAction === \"supplyChain.order.launch\" ? \"Opening\" : \"Open order\"}",
      "            </button>",
      "            <button",
      "              className=\"button ghost\"",
      "              disabled={loadingAction !== null || !shipment?.id}",
      "              onClick={() => void submitAction(\"supplyChain.shipment.expedite\", { shipmentId: shipment?.id })}",
      "            >",
      "              Expedite shipment",
      "            </button>",
      "          </div>",
      "        </section>",
      "",
      "        <section className=\"context-rail\" aria-label=\"Operational path\">",
      "          <div className=\"panel-head\">",
      "            <div>",
      "              <span className=\"eyebrow\">Path</span>",
      "              <h2>What gets linked</h2>",
      "            </div>",
      "          </div>",
      "          <div className=\"context-list\">",
      "            <div className=\"context-row\"><span>Supplier</span><strong>Risk and commercial owner</strong></div>",
      "            <div className=\"context-row\"><span>Order</span><strong>Spend and release state</strong></div>",
      "            <div className=\"context-row\"><span>Inventory</span><strong>SKU and stock position</strong></div>",
      "            <div className=\"context-row\"><span>Transport</span><strong>Carrier lane and ETA</strong></div>",
      "            <div className=\"context-row\"><span>Quality</span><strong>Arrival inspection</strong></div>",
      "          </div>",
      "        </section>",
      "",
      "        <section className=\"graph-panel\">",
      "          <div className=\"panel-head\">",
      "            <div>",
      "              <span className=\"eyebrow\">Live order</span>",
      "              <h2>{activeOrder?.reference ?? \"No order active\"}</h2>",
      "            </div>",
      "            <span className=\"status-pill\">{query.isLoading ? \"loading\" : activeOrder?.status ?? \"idle\"}</span>",
      "          </div>",
      "",
      "          {query.isLoading ? (",
      "            <div className=\"skeleton-stack\" aria-label=\"Loading order\">",
      "              <span />",
      "              <span />",
      "              <span />",
      "            </div>",
      "          ) : query.error ? (",
      "            <div className=\"error-banner\">{String(query.error)}</div>",
      "          ) : !activeOrder ? (",
      "            <div className=\"empty-state\">Open an order to create the first control tower view.</div>",
      "          ) : (",
      "            <>",
      "              <div className=\"raid-summary\">",
      "                <div>",
      "                  <span>supplier</span>",
      "                  <strong>{supplier?.name ?? \"unassigned\"}</strong>",
      "                </div>",
      "                <div>",
      "                  <span>region</span>",
      "                  <strong>{supplier?.region ?? \"unknown\"}</strong>",
      "                </div>",
      "                <div>",
      "                  <span>spend</span>",
      "                  <strong>{money(activeOrder.spend)}</strong>",
      "                </div>",
      "              </div>",
      "",
      "              <div className=\"lane-grid\">",
      "                <div className=\"lane\">",
      "                  <span className=\"manifest-label\">Inventory</span>",
      "                  {stockItems.map((item) => (",
      "                    <article className=\"objective\" key={item.id}>",
      "                      <strong>{item.sku}</strong>",
      "                      <span>{item.warehouse}</span>",
      "                      <em>{item.available} units / {item.safetyStock} safety</em>",
      "                    </article>",
      "                  ))}",
      "                </div>",
      "                <div className=\"lane\">",
      "                  <span className=\"manifest-label\">Transport</span>",
      "                  {shipments.map((entry) => (",
      "                    <article className=\"objective\" key={entry.id}>",
      "                      <strong>{entry.carrier}</strong>",
      "                      <span>{entry.lane}</span>",
      "                      <em>{entry.status} / {entry.etaHours}h ETA</em>",
      "                    </article>",
      "                  ))}",
      "                </div>",
      "                <div className=\"lane\">",
      "                  <span className=\"manifest-label\">Quality</span>",
      "                  {inspections.map((entry) => (",
      "                    <article className=\"objective\" key={entry.id}>",
      "                      <strong>{entry.result}</strong>",
      "                      <span>{entry.severity}</span>",
      "                      <em>{entry.note}</em>",
      "                    </article>",
      "                  ))}",
      "                </div>",
      "              </div>",
      "            </>",
      "          )}",
      "        </section>",
      "      </div>",
      "",
      "      {actionError ? <div className=\"error-banner\">{actionError}</div> : null}",
      "    </section>",
      "  );",
      "}",
    ].join("\n"),
    "src/domain.ts": [
      "import { defineAction, domain } from \"@ekairos/domain\";",
      "import { i } from \"@instantdb/core\";",
      "import { z } from \"zod\";",
      "",
      "export const supplierNetworkDomain = domain(\"supplierNetwork\").withSchema({",
      "  entities: {",
      "    supplierNetwork_supplier: i.entity({",
      "      name: i.string().indexed(),",
      "      region: i.string().indexed(),",
      "      risk: i.string().indexed(),",
      "      score: i.number().indexed(),",
      "      createdAt: i.number().indexed(),",
      "    }),",
      "  },",
      "  links: {},",
      "  rooms: {},",
      "});",
      "",
      "export const procurementDomain = domain(\"procurement\")",
      "  .includes(supplierNetworkDomain)",
      "  .withSchema({",
      "    entities: {",
      "      procurement_order: i.entity({",
      "        reference: i.string().indexed(),",
      "        status: i.string().indexed(),",
      "        spend: i.number().indexed(),",
      "        createdAt: i.number().indexed(),",
      "      }),",
      "    },",
      "    links: {",
      "      procurement_orderSupplier: {",
      "        forward: { on: \"procurement_order\", has: \"one\", label: \"supplier\" },",
      "        reverse: { on: \"supplierNetwork_supplier\", has: \"many\", label: \"orders\" },",
      "      },",
      "    },",
      "    rooms: {},",
      "  });",
      "",
      "export const inventoryDomain = domain(\"inventory\")",
      "  .includes(procurementDomain)",
      "  .withSchema({",
      "    entities: {",
      "      inventory_stockItem: i.entity({",
      "        sku: i.string().indexed(),",
      "        warehouse: i.string().indexed(),",
      "        available: i.number().indexed(),",
      "        safetyStock: i.number().indexed(),",
      "        createdAt: i.number().indexed(),",
      "      }),",
      "    },",
      "    links: {",
      "      inventory_stockItemOrder: {",
      "        forward: { on: \"inventory_stockItem\", has: \"one\", label: \"order\" },",
      "        reverse: { on: \"procurement_order\", has: \"many\", label: \"stockItems\" },",
      "      },",
      "    },",
      "    rooms: {},",
      "  });",
      "",
      "export const transportationDomain = domain(\"transportation\")",
      "  .includes(procurementDomain)",
      "  .withSchema({",
      "    entities: {",
      "      transportation_shipment: i.entity({",
      "        carrier: i.string().indexed(),",
      "        lane: i.string().indexed(),",
      "        status: i.string().indexed(),",
      "        etaHours: i.number().indexed(),",
      "        createdAt: i.number().indexed(),",
      "      }),",
      "    },",
      "    links: {",
      "      transportation_shipmentOrder: {",
      "        forward: { on: \"transportation_shipment\", has: \"one\", label: \"order\" },",
      "        reverse: { on: \"procurement_order\", has: \"many\", label: \"shipments\" },",
      "      },",
      "    },",
      "    rooms: {},",
      "  });",
      "",
      "export const qualityControlDomain = domain(\"qualityControl\")",
      "  .includes(transportationDomain)",
      "  .withSchema({",
      "    entities: {",
      "      qualityControl_inspection: i.entity({",
      "        result: i.string().indexed(),",
      "        severity: i.string().indexed(),",
      "        note: i.string(),",
      "        createdAt: i.number().indexed(),",
      "      }),",
      "    },",
      "    links: {",
      "      qualityControl_inspectionShipment: {",
      "        forward: { on: \"qualityControl_inspection\", has: \"one\", label: \"shipment\" },",
      "        reverse: { on: \"transportation_shipment\", has: \"many\", label: \"inspections\" },",
      "      },",
      "    },",
      "    rooms: {},",
      "  });",
      "",
      "const baseDomain = domain(\"supplyChain\")",
      "  .includes(inventoryDomain)",
      "  .includes(qualityControlDomain)",
      "  .withSchema({ entities: {}, links: {}, rooms: {} });",
      "",
      "export const launchOrderAction = defineAction({",
      "  name: \"supplyChain.order.launch\",",
      "  input: z.object({",
      "    reference: z.string().optional(),",
      "    supplierName: z.string().optional(),",
      "    sku: z.string().optional(),",
      "  }),",
      "  output: z.object({",
      "    supplierId: z.string(),",
      "    orderId: z.string(),",
      "    stockItemId: z.string(),",
      "    shipmentId: z.string(),",
      "    inspectionId: z.string(),",
      "  }),",
      "  async execute({ runtime, input }): Promise<{",
      "    supplierId: string;",
      "    orderId: string;",
      "    stockItemId: string;",
      "    shipmentId: string;",
      "    inspectionId: string;",
      "  }> {",
      "    const now = Date.now();",
      "    const supplierId = globalThis.crypto.randomUUID();",
      "    const orderId = globalThis.crypto.randomUUID();",
      "    const stockItemId = globalThis.crypto.randomUUID();",
      "    const shipmentId = globalThis.crypto.randomUUID();",
      "    const inspectionId = globalThis.crypto.randomUUID();",
      "",
      "    await runtime.db.transact([",
      "      runtime.db.tx.supplierNetwork_supplier[supplierId].update({",
      "        name: String(input?.supplierName ?? \"\").trim() || \"Marula Components\",",
      "        region: \"Pacific North\",",
      "        risk: \"watch\",",
      "        score: 82,",
      "        createdAt: now,",
      "      }),",
      "      runtime.db.tx.procurement_order[orderId].update({",
      "        reference: String(input?.reference ?? \"\").trim() || \"PO-7842\",",
      "        status: \"released\",",
      "        spend: 184700,",
      "        createdAt: now + 1,",
      "      }),",
      "      runtime.db.tx.procurement_order[orderId].link({ supplier: supplierId }),",
      "      runtime.db.tx.inventory_stockItem[stockItemId].update({",
      "        sku: String(input?.sku ?? \"\").trim() || \"DRV-2048\",",
      "        warehouse: \"Reno DC\",",
      "        available: 320,",
      "        safetyStock: 140,",
      "        createdAt: now + 2,",
      "      }),",
      "      runtime.db.tx.inventory_stockItem[stockItemId].link({ order: orderId }),",
      "      runtime.db.tx.transportation_shipment[shipmentId].update({",
      "        carrier: \"Northstar Freight\",",
      "        lane: \"Reno -> Austin\",",
      "        status: \"in-transit\",",
      "        etaHours: 38,",
      "        createdAt: now + 3,",
      "      }),",
      "      runtime.db.tx.transportation_shipment[shipmentId].link({ order: orderId }),",
      "      runtime.db.tx.qualityControl_inspection[inspectionId].update({",
      "        result: \"pending\",",
      "        severity: \"medium\",",
      "        note: \"Inspect seal integrity on arrival.\",",
      "        createdAt: now + 4,",
      "      }),",
      "      runtime.db.tx.qualityControl_inspection[inspectionId].link({ shipment: shipmentId }),",
      "    ]);",
      "",
      "    return { supplierId, orderId, stockItemId, shipmentId, inspectionId };",
      "  },",
      "});",
      "",
      "export const expediteShipmentAction = defineAction({",
      "  name: \"supplyChain.shipment.expedite\",",
      "  input: z.object({ shipmentId: z.string().optional() }),",
      "  output: z.object({ shipmentId: z.string() }),",
      "  async execute({ runtime, input }): Promise<{ shipmentId: string }> {",
      "    const shipmentId = String(input?.shipmentId ?? \"\").trim();",
      "    if (!shipmentId) throw new Error(\"shipmentId is required\");",
      "",
      "    await runtime.db.transact([",
      "      runtime.db.tx.transportation_shipment[shipmentId].update({",
      "        status: \"expedited\",",
      "        etaHours: 16,",
      "      }),",
      "    ]);",
      "",
      "    return { shipmentId };",
      "  },",
      "});",
      "",
      "export const appDomain = baseDomain.withActions({",
      "  expediteShipment: expediteShipmentAction,",
      "  launchOrder: launchOrderAction,",
      "});",
      "",
      "export default appDomain;",
    ].join("\n"),
    "src/runtime.ts": [
      'import { init } from "@instantdb/admin";',
      'import { EkairosRuntime } from "@ekairos/domain/runtime-handle";',
      'import { configureRuntime } from "@ekairos/domain/runtime";',
      'import appDomain from "./domain";',
      "",
      "export type AppRuntimeEnv = {",
      "  actorEmail?: string | null;",
      "  actorId?: string;",
      "  adminToken?: string;",
      "  appId?: string;",
      "};",
      "",
      "function resolveRuntimeEnv(env: AppRuntimeEnv = {}): Required<Pick<AppRuntimeEnv, \"appId\" | \"adminToken\">> & AppRuntimeEnv {",
      '  const appId = String(env.appId ?? process.env.NEXT_PUBLIC_INSTANT_APP_ID ?? "").trim();',
      '  const adminToken = String(env.adminToken ?? process.env.INSTANT_ADMIN_TOKEN ?? "").trim();',
      "  if (!appId || !adminToken) {",
      '    throw new Error("Missing NEXT_PUBLIC_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN. Copy .env.example to .env.local and fill both values.");',
      "  }",
      "  return {",
      "    ...env,",
      "    appId,",
      "    adminToken,",
      "  };",
      "}",
      "",
      "export class AppRuntime extends EkairosRuntime<AppRuntimeEnv, typeof appDomain, any> {",
      "  protected getDomain() {",
      "    return appDomain;",
      "  }",
      "",
      "  protected async resolveDb(env: AppRuntimeEnv) {",
      "    const resolved = resolveRuntimeEnv(env);",
      "    return init({",
      "      appId: resolved.appId,",
      "      adminToken: resolved.adminToken,",
      "      schema: appDomain.toInstantSchema(),",
      "      useDateObjects: true,",
      "    } as any) as any;",
      "  }",
      "}",
      "",
      "export function createRuntime(env: AppRuntimeEnv = {}) {",
      "  return new AppRuntime(resolveRuntimeEnv(env));",
      "}",
      "",
      "export const runtimeConfig = configureRuntime<AppRuntimeEnv>({",
      "  runtime: async (env) => {",
      "    const runtime = createRuntime(env);",
      "    return { db: await runtime.db() };",
      "  },",
      "  domain: {",
      "    domain: appDomain,",
      "  },",
      "});",
    ].join("\n"),
    "src/workflows/demo.workflow.ts": [
      "import type { ActiveDomain } from \"@ekairos/domain\";",
      "import appDomain from \"../domain\";",
      "import { createRuntime } from \"../runtime\";",
      "",
      "export type DemoWorkflowInput = {",
      "  expedite?: boolean;",
      "  reference?: string;",
      "  sku?: string;",
      "  supplierName?: string;",
      "};",
      "",
      "export async function runDemoWorkflow(input: DemoWorkflowInput) {",
      "  \"use workflow\";",
      "  const runtime = createRuntime();",
      "  const scoped = (await runtime.use(appDomain)) as ActiveDomain<typeof appDomain>;",
      "  const created = await scoped.actions.launchOrder({",
      "    reference: input.reference,",
      "    sku: input.sku,",
      "    supplierName: input.supplierName,",
      "  });",
      "",
      "  if (input.expedite) {",
      "    await scoped.actions.expediteShipment({",
      "      shipmentId: created.shipmentId,",
      "    });",
      "  }",
      "",
      "  return created;",
      "}",
    ].join("\n"),
  }
}

export async function createDomainApp(
  params: CreateDomainAppParams,
): Promise<CreateDomainAppResult> {
  if (params.framework !== "next") {
    throw new Error("Only --next is supported right now.")
  }

  const template = resolveCreateAppTemplate(params)
  if (params.smoke && !params.install) {
    throw new Error("--smoke requires dependencies. Remove --no-install or run smoke after installing.")
  }
  if (params.demo && !params.smoke) {
    throw new Error("--demo runs the full app cycle and requires smoke validation.")
  }

  const targetDir = resolve(params.directory || ".")
  await emitProgress(params.onProgress, {
    stage: "prepare-target",
    status: "running",
    message: `Preparing ${targetDir}`,
    progress: 5,
  })
  await ensureWritableTargetDirectory(targetDir, params.force)
  await emitProgress(params.onProgress, {
    stage: "prepare-target",
    status: "completed",
    message: "Target ready",
    progress: 12,
  })

  await emitProgress(params.onProgress, {
    stage: "detect-package-manager",
    status: "running",
    message: "Detecting package manager",
    progress: 16,
  })
  const packageManager = await detectPackageManager(params.packageManager, params.workspacePath)
  await emitProgress(params.onProgress, {
    stage: "detect-package-manager",
    status: "completed",
    message: `Using ${packageManager}`,
    progress: 22,
  })

  await emitProgress(params.onProgress, {
    stage: "resolve-version",
    status: "running",
    message: "Resolving @ekairos/domain version",
    progress: 26,
  })
  const domainVersion = await readDomainPackageVersion()
  await emitProgress(params.onProgress, {
    stage: "resolve-version",
    status: "completed",
    message: `Version ${domainVersion}`,
    progress: 30,
  })

  const explicitAppId = trimOrEmpty(params.appId)
  const explicitAdminToken = trimOrEmpty(params.adminToken)
  const shouldProvision =
    Boolean(trimOrEmpty(params.instantToken)) &&
    (!explicitAppId || !explicitAdminToken)

  let provisioned: Awaited<ReturnType<typeof provisionInstantApp>> | null = null
  if (shouldProvision) {
    await emitProgress(params.onProgress, {
      stage: "provision-instant",
      status: "running",
      message: "Provisioning Instant app",
      progress: 38,
    })
    provisioned = await provisionInstantApp({
      directory: targetDir,
      template,
      instantToken: trimOrEmpty(params.instantToken),
      orgId: params.orgId,
    })
    await emitProgress(params.onProgress, {
      stage: "provision-instant",
      status: "completed",
      message: `Provisioned ${provisioned.appId}`,
      progress: 50,
    })
  }

  const appId = explicitAppId || provisioned?.appId || null
  const adminToken = explicitAdminToken || provisioned?.adminToken || null
  if (params.smoke && (!appId || !adminToken)) {
    throw new Error(
      params.demo
        ? "--demo requires Instant provisioning. Set INSTANT_PERSONAL_ACCESS_TOKEN or pass --instantToken."
        : "--smoke requires a configured Instant app. Pass --instantToken or --appId with --adminToken.",
    )
  }

  await emitProgress(params.onProgress, {
    stage: "write-files",
    status: "running",
    message: "Writing scaffold files",
    progress: 58,
  })
  const files = buildNextTemplateFiles({
    targetDir,
    template,
    domainVersion,
    packageManager,
    workspacePath: params.workspacePath,
  })
  await writeScaffoldFiles(targetDir, files)
  await emitProgress(params.onProgress, {
    stage: "write-files",
    status: "completed",
    message: "Scaffold files written",
    progress: 72,
  })

  const envFile = appId && adminToken ? join(targetDir, ".env.local") : null
  if (appId && adminToken && envFile) {
    await emitProgress(params.onProgress, {
      stage: "write-env",
      status: "running",
      message: "Writing .env.local",
      progress: 78,
    })
    await writeFile(
      envFile,
      [
        `NEXT_PUBLIC_INSTANT_APP_ID=${appId}`,
        `INSTANT_ADMIN_TOKEN=${adminToken}`,
        "",
      ].join("\n"),
      "utf8",
    )
    await emitProgress(params.onProgress, {
      stage: "write-env",
      status: "completed",
      message: ".env.local ready",
      progress: 84,
    })
  }

  if (params.install) {
    await emitProgress(params.onProgress, {
      stage: "install",
      status: "running",
      message: `Installing dependencies with ${packageManager}`,
      progress: 88,
    })
    await runInstall(targetDir, packageManager, params.onProgress)
    await emitProgress(params.onProgress, {
      stage: "install",
      status: "completed",
      message: "Dependencies installed",
      progress: 96,
    })
  }

  const smoke = params.smoke
    ? await runSmoke({
        demo: template === "supply-chain",
        targetDir,
        packageManager,
        keepServer: Boolean(params.keepServer),
        onKeepServer: params.onKeepServer,
        onProgress: params.onProgress,
      })
    : null

  const cliCommand = packageBinCommandFor(packageManager, "domain")
  const reviewUrl = smoke?.baseUrl ?? "http://localhost:3000"
  const startStep = smoke?.keepServer
    ? `Open ${reviewUrl} for review`
    : params.install
      ? runScriptCommandFor(packageManager, "dev")
      : `${installCommandFor(packageManager)} && ${runScriptCommandFor(packageManager, "dev")}`
  const nextSteps =
    template === "supply-chain"
      ? [
          `cd ${targetDir}`,
          startStep,
          `Open ${reviewUrl} and launch a purchase order from the control tower UI`,
          `${cliCommand} inspect --baseUrl=${reviewUrl} --admin --pretty`,
          `${cliCommand} "supplyChain.order.launch" "{ reference: 'PO-7842', supplierName: 'Marula Components', sku: 'DRV-2048' }" --baseUrl=${reviewUrl} --admin --pretty`,
          `${cliCommand} query "{ procurement_order: { supplier: {}, stockItems: {}, shipments: { inspections: {} } } }" --baseUrl=${reviewUrl} --admin --pretty`,
        ]
      : template === "agent"
        ? [
            `cd ${targetDir}`,
            startStep,
            `Open ${reviewUrl} and start a context through /api/agent/react`,
            `Inspect the returned context id in Workbench v2 for app ${appId || "<instant-app-id>"}`,
            `Iterate on src/agent.ts`,
          ]
      : [
          `cd ${targetDir}`,
          startStep,
          `Open ${reviewUrl} and add your first domain in src/domain.ts`,
          `${cliCommand} inspect --baseUrl=${reviewUrl} --admin --pretty`,
        ]

  const result: CreateDomainAppResult = {
    ok: true,
    directory: targetDir,
    framework: params.framework,
    template,
    installed: params.install,
    packageManager,
    provisioned: Boolean(provisioned),
    appId,
    adminToken,
    adminTokenWritten: Boolean(envFile),
    envFile,
    smoke,
    demo: Boolean(params.demo),
    nextSteps,
  }

  await emitProgress(params.onProgress, {
    stage: "complete",
    status: "completed",
    message: "App scaffolded successfully",
    progress: 100,
  })

  return result
}

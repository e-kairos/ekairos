import { createOpenAI } from "@ai-sdk/openai"
import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"
import { contextDomain } from "@ekairos/events/schema"
import { ai } from "@ekairos/reactor"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { sandboxDomain } from "../../../../sandbox/src/schema.ts"

import { materializeDataset } from "../../dataset.js"
import { datasetDomain } from "../../schema.js"

type InstantAdminInit = typeof import("@instantdb/admin")["init"]

export const esolbayAwardDatasetWorkflowReproDomain = domain(
  "dataset-esolbay-award-workflow-repro",
)
  .includes(datasetDomain)
  .includes(contextDomain)
  .includes(sandboxDomain)
  .schema({ entities: {}, links: {}, rooms: {} })
  .withActions(datasetDomain.actions)

export type EsolbayAwardDatasetWorkflowReproEnv = {
  orgId: string
  appId: string
  adminToken: string
}

export class EsolbayAwardDatasetWorkflowReproRuntime extends EkairosRuntime<
  EsolbayAwardDatasetWorkflowReproEnv,
  typeof esolbayAwardDatasetWorkflowReproDomain,
  ReturnType<InstantAdminInit>
> {
  static [WORKFLOW_SERIALIZE](instance: EsolbayAwardDatasetWorkflowReproRuntime) {
    return { env: instance.env }
  }

  static [WORKFLOW_DESERIALIZE](data: { env: EsolbayAwardDatasetWorkflowReproEnv }) {
    return new EsolbayAwardDatasetWorkflowReproRuntime(data.env)
  }

  protected getDomain() {
    return esolbayAwardDatasetWorkflowReproDomain
  }

  protected async resolveDb(env: EsolbayAwardDatasetWorkflowReproEnv) {
    const { init } = await import("@instantdb/admin")
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: esolbayAwardDatasetWorkflowReproDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }
}

export type EsolbayAwardDatasetOperationInput = {
  runtime: EsolbayAwardDatasetWorkflowReproRuntime
  orgId: string
  originalWorkflowRunId: string
  originalDatasetId: string
  datasetId: string
  fileId: string
  instructions: string
  outputSchema: any
}

export type EsolbayAwardDatasetOperationResult = {
  datasetId: string
  originalDatasetId: string
  workflowRunId: string
  datasetBuildDurationMs: number
  rowCount: number
  previewRows: unknown[]
  rows: unknown[]
}

const SUPPORTED_MODEL_IDS = ["gpt-5.2", "gpt-5.3-codex"] as const
type SupportedModelId = (typeof SUPPORTED_MODEL_IDS)[number]

const MODEL_ALIASES: Record<string, SupportedModelId> = {
  "gpt-4": "gpt-5.2",
  "gpt-4.1": "gpt-5.2",
  "gpt-5": "gpt-5.2",
  "gpt-5.1": "gpt-5.2",
  "gpt-5.1-thinking": "gpt-5.2",
  "gpt-5.2": "gpt-5.2",
  "gpt-5-codex": "gpt-5.3-codex",
  "gpt-5.3-codex": "gpt-5.3-codex",
  "o4-mini": "gpt-5.2",
  "codex-5.2": "gpt-5.3-codex",
  "azure/codex-5.2": "gpt-5.3-codex",
  "azure/gpt-5.2": "gpt-5.2",
  "azure/gpt-5.3-codex": "gpt-5.3-codex",
}

type OpenAIProvider = ReturnType<typeof createOpenAI>

let cachedAzureProvider: OpenAIProvider | null = null

function readTrimmedEnv(name: string): string {
  return String(process.env[name] ?? "").trim()
}

function getRequiredEnv(name: string): string {
  const value = readTrimmedEnv(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function resolveModelId(): SupportedModelId {
  const configured = readTrimmedEnv("AI_MODEL_AWARD_ADD_BID_ITEMS")
  const alias = (configured || "gpt-5.2").toLowerCase()
  const model = MODEL_ALIASES[alias]
  if (!model) {
    throw new Error(
      `Unsupported award.addBidItems model alias "${configured}". Allowed values: ${SUPPORTED_MODEL_IDS.join(", ")}`,
    )
  }
  return model
}

function buildAzureBaseUrl(): string {
  const endpoint = readTrimmedEnv("AZURE_OPENAI_ENDPOINT")
  if (endpoint) {
    const normalized = endpoint.replace(/\/+$/, "")
    return normalized.endsWith("/openai") ? normalized : `${normalized}/openai`
  }
  return `https://${getRequiredEnv("AZURE_RESOURCE_NAME")}.openai.azure.com/openai`
}

function createAzureFetchWithApiVersion(apiVersion: string) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url
    const url = new URL(rawUrl)
    if (!url.searchParams.has("api-version")) {
      url.searchParams.set("api-version", apiVersion)
    }

    let nextInit = init
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body)
        if (Array.isArray(body?.tools)) {
          body.tools = body.tools.map((toolItem: any) => {
            if (
              toolItem?.type === "function" &&
              toolItem?.function &&
              typeof toolItem.function === "object" &&
              "strict" in toolItem.function
            ) {
              const { strict: _strict, ...restFunction } = toolItem.function
              return { ...toolItem, function: restFunction }
            }
            return toolItem
          })
        }
        body.store = true
        nextInit = { ...init, body: JSON.stringify(body) }
      } catch {
        nextInit = init
      }
    }

    return fetch(url.toString(), nextInit)
  }
}

function getAzureProvider(): OpenAIProvider {
  if (cachedAzureProvider) return cachedAzureProvider

  const apiKey = readTrimmedEnv("AZURE_API_KEY") || readTrimmedEnv("AZURE_OPENAI_API_KEY")
  if (!apiKey) {
    throw new Error("Missing Azure API key. Set AZURE_API_KEY or AZURE_OPENAI_API_KEY.")
  }

  const apiVersion = readTrimmedEnv("AZURE_API_VERSION") || "2025-04-01-preview"
  cachedAzureProvider = createOpenAI({
    apiKey,
    baseURL: buildAzureBaseUrl(),
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    fetch: createAzureFetchWithApiVersion(apiVersion),
  })

  return cachedAzureProvider
}

async function createAwardAddBidItemsModelStep() {
  "use step"

  return getAzureProvider().responses(resolveModelId() as any)
}

export async function createEsolbayAwardDatasetSandboxStep(params: {
  runtime: EsolbayAwardDatasetWorkflowReproRuntime
  orgId: string
  datasetId: string
  fileId: string
}): Promise<{ sandboxId: string }> {
  "use step"

  const { SandboxService } = await import("@ekairos/sandbox/service")
  const service = new SandboxService((await params.runtime.db()) as any)
  const created = await service.createSandbox({
    provider: "vercel",
    runtime: "python3.13",
    timeoutMs: 20 * 60 * 1000,
    resources: { vcpus: 2 },
    purpose: "award.bidItems.dataset",
    params: {
      orgId: params.orgId,
      datasetId: params.datasetId,
      fileId: params.fileId,
    },
  })
  if (!created.ok) throw new Error(created.error)
  return { sandboxId: created.data.sandboxId }
}

export async function stopEsolbayAwardDatasetSandboxStep(params: {
  runtime: EsolbayAwardDatasetWorkflowReproRuntime
  sandboxId: string
}): Promise<void> {
  "use step"

  const { SandboxService } = await import("@ekairos/sandbox/service")
  const service = new SandboxService((await params.runtime.db()) as any)
  const stopped = await service.stopSandbox(params.sandboxId)
  if (!stopped.ok) throw new Error(stopped.error)
}

export async function esolbayAwardDatasetOperationWorkflow(
  input: EsolbayAwardDatasetOperationInput,
): Promise<EsolbayAwardDatasetOperationResult> {
  "use workflow"

  const startedAt = Date.now()
  const sandbox = await createEsolbayAwardDatasetSandboxStep({
    runtime: input.runtime,
    orgId: input.orgId,
    datasetId: input.datasetId,
    fileId: input.fileId,
  })

  try {
    const result = await materializeDataset(input.runtime as any, {
      datasetId: input.datasetId,
    })
      .sandbox(sandbox.sandboxId)
      .from({ kind: "file", fileId: input.fileId })
      .engine(ai({ model: createAwardAddBidItemsModelStep }))
      .instructions(input.instructions)
      .schema(input.outputSchema as any)
      .asRows()
      .build()

    const read = await result.reader.read({ cursor: 0, limit: 200 })
    const { getWorkflowMetadata } = await import("workflow")

    return {
      datasetId: result.datasetId,
      originalDatasetId: input.originalDatasetId,
      workflowRunId: String(getWorkflowMetadata?.()?.workflowRunId ?? ""),
      datasetBuildDurationMs: Date.now() - startedAt,
      rowCount: read.rows.length,
      previewRows: result.previewRows,
      rows: read.rows,
    }
  } finally {
    await stopEsolbayAwardDatasetSandboxStep({
      runtime: input.runtime,
      sandboxId: sandbox.sandboxId,
    })
  }
}

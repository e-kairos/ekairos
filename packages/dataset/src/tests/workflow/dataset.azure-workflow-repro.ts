import { domain } from "@ekairos/domain"
import { EkairosRuntime } from "@ekairos/domain/runtime"
import { eventsDomain } from "@ekairos/events"
import type { ContextReactor } from "@ekairos/reactor/context"
import {
  createOpenAIResponsesReactor,
  type OpenAIResponsesConfig,
} from "@ekairos/openai-reactor"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import { sandboxDomain } from "../../../../sandbox/src/schema.ts"

import { dataset } from "../../dataset.js"
import { datasetDomain } from "../../schema.js"

type InstantAdminInit = typeof import("@instantdb/admin")["init"]

export const datasetAzureWorkflowReproDomain = domain(
  "dataset-azure-workflow-repro",
)
  .includes(datasetDomain)
  .includes(eventsDomain)
  .includes(sandboxDomain)
  .schema({ entities: {}, links: {}, rooms: {} })

export type DatasetAzureWorkflowReproEnv = {
  orgId: string
  appId: string
  adminToken: string
}

export class DatasetAzureWorkflowReproRuntime extends EkairosRuntime<
  DatasetAzureWorkflowReproEnv,
  typeof datasetAzureWorkflowReproDomain,
  ReturnType<InstantAdminInit>
> {
  static [WORKFLOW_SERIALIZE](instance: DatasetAzureWorkflowReproRuntime) {
    return { env: instance.env }
  }

  static [WORKFLOW_DESERIALIZE](data: { env: DatasetAzureWorkflowReproEnv }) {
    return new DatasetAzureWorkflowReproRuntime(data.env)
  }

  protected getDomain() {
    return datasetAzureWorkflowReproDomain
  }

  protected async resolveDb(env: DatasetAzureWorkflowReproEnv) {
    const { init } = await import("@instantdb/admin")
    return init({
      appId: env.appId,
      adminToken: env.adminToken,
      schema: datasetAzureWorkflowReproDomain.toInstantSchema(),
      useDateObjects: true,
    } as any)
  }
}

type DatasetAzureWorkflowReproInput = {
  runtime: DatasetAzureWorkflowReproRuntime
  datasetId: string
  fileId: string
  sandboxId: string
}

type DatasetAzureWorkflowReproResult = {
  datasetId: string
  workflowRunId: string
  datasetBuildDurationMs: number
  rowCount: number
  rows: unknown[]
}

function readTrimmedEnv(name: string): string {
  return String(process.env[name] ?? "").trim()
}

function getRequiredEnv(name: string): string {
  const value = readTrimmedEnv(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function resolveAzureApiKeyEnvName(): string {
  if (readTrimmedEnv("AZURE_API_KEY")) return "AZURE_API_KEY"
  if (readTrimmedEnv("AZURE_OPENAI_API_KEY")) return "AZURE_OPENAI_API_KEY"
  throw new Error(
    "Missing Azure API key. Set AZURE_API_KEY or AZURE_OPENAI_API_KEY.",
  )
}

function buildAzureOpenAIResponsesWebSocketUrl(): string {
  const apiVersion =
    readTrimmedEnv("AZURE_API_VERSION") || "2025-04-01-preview"
  const endpoint = readTrimmedEnv("AZURE_OPENAI_ENDPOINT")
  const baseUrl = endpoint
    ? endpoint.replace(/\/+$/, "").endsWith("/openai")
      ? endpoint.replace(/\/+$/, "")
      : `${endpoint.replace(/\/+$/, "")}/openai`
    : `https://${getRequiredEnv("AZURE_RESOURCE_NAME")}.openai.azure.com/openai`

  const url = new URL(baseUrl)
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/responses`
  url.searchParams.set("api-version", apiVersion)
  return url.toString()
}

export async function resolveDatasetAzureWorkflowReproConfigStep(): Promise<OpenAIResponsesConfig> {
  "use step"

  const apiKeyEnv = resolveAzureApiKeyEnvName()
  const model =
    readTrimmedEnv("AI_MODEL_REQUISITION_ADD_ITEMS") ||
    readTrimmedEnv("AI_MODEL_REQUISITION_AGENT_CONTEXT") ||
    "gpt-5.2"

  return {
    model,
    webSocketUrl: buildAzureOpenAIResponsesWebSocketUrl(),
    headersFromEnv: {
      apiKeyEnv,
      authorizationBearerEnv: apiKeyEnv,
    },
    requestDefaults: {
      store: true,
      tool_choice: "required",
      parallel_tool_calls: false,
    },
    providerName: "azure-openai-responses:dataset.workflow.repro",
    reuseHotConnection: true,
    usePreviousResponseId: true,
    idleTtlMs: 120_000,
    maxHotConnections: 2,
    handshakeTimeoutMs: 30_000,
    requestTimeoutMs: 90_000,
    strictJsonSchema: false,
  }
}

function createDatasetAzureWorkflowReproReactor<
  Context,
  Env extends Record<string, unknown>,
>(): ContextReactor<Context, Env> {
  return createOpenAIResponsesReactor<Context, OpenAIResponsesConfig, Env>({
    resolveConfig: async () =>
      await resolveDatasetAzureWorkflowReproConfigStep(),
    includeStreamTraceInOutput: true,
    includeRawProviderEventsInOutput: false,
    maxPersistedStreamEvents: 300,
  }) as unknown as ContextReactor<Context, Env>
}

const requisitionItemSchema = {
  title: "RequisitionItem",
  description: "Normalized requisition item row from an attached file.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["code", "name", "quantity", "unitOfMeasure"],
    properties: {
      code: { type: "string" },
      name: { type: "string" },
      quantity: { type: "number" },
      unitOfMeasure: { type: "string" },
    },
  },
}

export async function datasetAzureFileWorkflowRepro(
  input: DatasetAzureWorkflowReproInput,
): Promise<DatasetAzureWorkflowReproResult> {
  "use workflow"

  const startedAt = Date.now()
  const result = await dataset(input.runtime as any, {
    datasetId: input.datasetId,
    durable: true,
  })
    .sandbox({ sandboxId: input.sandboxId })
    .from({
      kind: "file",
      fileId: input.fileId,
      description: "CSV requisition items attachment",
    })
    .reactor(createDatasetAzureWorkflowReproReactor())
    .instructions(
      [
        "Extract requisition item rows from the attached CSV file.",
        "Use executeCommand to parse the file and write the dataset output JSONL.",
        "Then call completeDataset.",
        "Each JSONL row must be exactly { type: \"row\", data: { code, name, quantity, unitOfMeasure } }.",
        "Do not wrap rows in an items array.",
      ].join("\n"),
    )
    .schema(requisitionItemSchema as any)
    .asRows()
    .build()

  const read = await result.reader.read({ cursor: 0, limit: 50 })
  const { getWorkflowMetadata } = await import("workflow")

  return {
    datasetId: result.datasetId,
    workflowRunId: String(getWorkflowMetadata?.()?.workflowRunId ?? ""),
    datasetBuildDurationMs: Date.now() - startedAt,
    rowCount: read.rows.length,
    rows: read.rows,
  }
}

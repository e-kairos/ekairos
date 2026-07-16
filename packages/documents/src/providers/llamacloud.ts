import {
  ProviderResultNotReadyError,
  type DocumentParseProvider,
  type NormalizedParseResult,
  type ProviderJobRef,
  type ProviderJobStatus,
  type ProviderParseOptions,
  type ProviderResultType,
} from "./provider.js"

const LLAMA_CLOUD_API_BASE = "https://api.cloud.llamaindex.ai/api/v1"

export type LlamaCloudParseMode =
  | "parse_page_without_llm"
  | "parse_page_with_llm"
  | "parse_page_with_lvm"
  | "parse_page_with_agent"
  | "parse_document_with_llm"
  | "parse_document_with_agent"

export type LlamaCloudParseConfig = {
  parse_mode?: LlamaCloudParseMode
  model?: string
  high_res_ocr?: boolean
  output_tables_as_HTML?: boolean
  adaptive_long_table?: boolean
  outlined_table_extraction?: boolean
  precise_bounding_box?: boolean
  language?: string
}

export type LlamaCloudProviderOptions = {
  apiKey?: string
  /** Default parse configuration merged under per-call config. */
  config?: LlamaCloudParseConfig
}

const DEFAULT_PARSE_CONFIG: LlamaCloudParseConfig = {
  parse_mode: "parse_page_with_llm",
  high_res_ocr: true,
  adaptive_long_table: true,
  outlined_table_extraction: true,
  output_tables_as_HTML: true,
}

export class LlamaCloudProvider implements DocumentParseProvider {
  public readonly name = "llamacloud"
  public readonly supportedResultTypes: ProviderResultType[] = [
    "markdown",
    "text",
  ]

  private readonly apiKey: string
  private readonly defaultConfig: LlamaCloudParseConfig

  constructor(options: LlamaCloudProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.LLAMA_CLOUD_API_KEY ?? ""
    if (!this.apiKey) {
      throw new Error(
        "LlamaCloud API key is required. Set LLAMA_CLOUD_API_KEY or pass { apiKey }.",
      )
    }
    this.defaultConfig = { ...DEFAULT_PARSE_CONFIG, ...options.config }
  }

  async uploadAndStartParse(
    file: Buffer,
    filename: string,
    options: ProviderParseOptions,
  ): Promise<ProviderJobRef> {
    const config: LlamaCloudParseConfig = {
      ...this.defaultConfig,
      ...(options.config && typeof options.config === "object"
        ? (options.config as LlamaCloudParseConfig)
        : {}),
    }

    const formData = new FormData()
    formData.append(
      "file",
      new Blob([new Uint8Array(file)], { type: "application/octet-stream" }),
      filename,
    )
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value))
      }
    }

    const response = await this.request("/parsing/upload", {
      method: "POST",
      body: formData,
    })
    const data = (await response.json()) as { id?: string; job_id?: string }
    const externalJobId = data.id ?? data.job_id
    if (!externalJobId) {
      throw new Error("LlamaCloud upload response missing job id")
    }
    return {
      provider: this.name,
      externalJobId,
      requestRaw: { filename, config, resultType: options.resultType },
    }
  }

  async getStatus(
    externalJobId: string,
  ): Promise<{ status: ProviderJobStatus; error?: string }> {
    const response = await this.request(`/parsing/job/${externalJobId}`)
    const data = (await response.json()) as { status?: string; error?: string }
    return {
      status: normalizeLlamaStatus(data.status),
      error: data.error,
    }
  }

  async fetchResult(
    externalJobId: string,
    options?: { resultType?: ProviderResultType },
  ): Promise<NormalizedParseResult> {
    const resultType = options?.resultType ?? "markdown"
    const response = await this.request(
      `/parsing/job/${externalJobId}/result/${resultType}`,
    )
    const data = (await response.json()) as {
      pages?: Array<{ page?: number; text?: string; md?: string }>
      markdown?: string
      text?: string
    }

    const rawPages = Array.isArray(data.pages) ? data.pages : []
    if (rawPages.length === 0) {
      const flat = data.markdown ?? data.text
      if (typeof flat === "string" && flat.trim().length > 0) {
        return {
          pages: [
            {
              pageIndex: 0,
              text: resultType === "text" ? flat : undefined,
              markdown: resultType === "markdown" ? flat : undefined,
            },
          ],
          raw: data,
        }
      }
      throw new ProviderResultNotReadyError(
        `LlamaCloud ${resultType} result has no pages yet for job ${externalJobId}`,
      )
    }

    return {
      pages: rawPages.map((page, index) => ({
        pageIndex:
          typeof page.page === "number" && page.page > 0
            ? page.page - 1
            : index,
        text: page.text,
        markdown: page.md,
      })),
      raw: data,
    }
  }

  private async request(
    endpoint: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const response = await fetch(`${LLAMA_CLOUD_API_BASE}${endpoint}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.body instanceof FormData ? {} : { Accept: "application/json" }),
      },
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error")
      throw new Error(
        `LlamaCloud API error: ${response.status} ${response.statusText}. ${errorText}`,
      )
    }
    return response
  }
}

function normalizeLlamaStatus(status: string | undefined): ProviderJobStatus {
  const normalized = (status ?? "").toLowerCase()
  switch (normalized) {
    case "success":
    case "completed":
      return "success"
    case "error":
    case "failed":
      return "failed"
    case "cancelled":
    case "canceled":
      return "canceled"
    case "pending":
    case "queued":
      return "queued"
    default:
      return "processing"
  }
}

/** Convenience factory: `documents(runtime, { provider: llamaCloud() })`. */
export function llamaCloud(
  options: LlamaCloudProviderOptions = {},
): LlamaCloudProvider {
  return new LlamaCloudProvider(options)
}

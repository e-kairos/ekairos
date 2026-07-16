import type {
  DocumentParseProvider,
  NormalizedParseResult,
  ProviderJobRef,
  ProviderJobStatus,
  ProviderParseOptions,
  ProviderResultType,
} from "./provider.js"

const REDUCTO_API_BASE = "https://platform.reducto.ai"

export type ReductoParseConfig = Record<string, unknown>

export type ReductoProviderOptions = {
  apiKey?: string
  /** Default request body merged under per-call config (see Reducto /parse docs). */
  config?: ReductoParseConfig
}

export class ReductoProvider implements DocumentParseProvider {
  public readonly name = "reducto"
  public readonly supportedResultTypes: ProviderResultType[] = [
    "markdown",
    "text",
  ]

  private readonly apiKey: string
  private readonly defaultConfig: ReductoParseConfig

  constructor(options: ReductoProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.REDUCTO_API_KEY ?? ""
    if (!this.apiKey) {
      throw new Error(
        "Reducto API key is required. Set REDUCTO_API_KEY or pass { apiKey }.",
      )
    }
    this.defaultConfig = { ...options.config }
  }

  async uploadAndStartParse(
    file: Buffer,
    filename: string,
    options: ProviderParseOptions,
  ): Promise<ProviderJobRef> {
    const formData = new FormData()
    formData.append("file", new Blob([new Uint8Array(file)]), filename)

    const uploadResponse = await this.request("/upload", {
      method: "POST",
      body: formData,
    })
    const upload = (await uploadResponse.json()) as {
      url?: string
      file_url?: string
    }
    const fileUrl = upload.url ?? upload.file_url
    if (!fileUrl) {
      throw new Error("Reducto upload response missing file url")
    }

    const parseRequest: Record<string, unknown> = {
      input: fileUrl,
      ...this.defaultConfig,
      ...(options.config && typeof options.config === "object"
        ? (options.config as Record<string, unknown>)
        : {}),
    }

    const parseResponse = await this.request("/parse/async", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parseRequest),
    })
    const parse = (await parseResponse.json()) as { job_id?: string }
    if (!parse.job_id) {
      throw new Error("Reducto parse/async response missing job_id")
    }

    return {
      provider: this.name,
      externalJobId: parse.job_id,
      fileUrl,
      requestRaw: { parse: parseRequest },
    }
  }

  async getStatus(
    externalJobId: string,
  ): Promise<{ status: ProviderJobStatus; error?: string }> {
    const response = await this.request(`/job/${externalJobId}`)
    const data = (await response.json()) as { status?: string; reason?: string }
    return {
      status: normalizeReductoStatus(data.status),
      error: data.reason,
    }
  }

  async fetchResult(
    externalJobId: string,
    _options?: { resultType?: ProviderResultType },
  ): Promise<NormalizedParseResult> {
    const response = await this.request(`/job/${externalJobId}`)
    const data = (await response.json()) as {
      result?: {
        result?: { chunks?: Array<{ blocks?: ReductoBlock[] }> }
        usage?: { num_pages?: number; credits?: number }
      }
    }

    const chunks = data.result?.result?.chunks ?? []
    const blocks = chunks.flatMap((chunk) =>
      Array.isArray(chunk.blocks) ? chunk.blocks : [],
    )

    const byPage = new Map<number, ReductoBlock[]>()
    for (const block of blocks) {
      const page = typeof block.bbox?.page === "number" ? block.bbox.page : 1
      const pageIndex = Math.max(0, page - 1)
      const list = byPage.get(pageIndex) ?? []
      list.push(block)
      byPage.set(pageIndex, list)
    }

    const pages = [...byPage.entries()]
      .sort(([a], [b]) => a - b)
      .map(([pageIndex, pageBlocks]) => ({
        pageIndex,
        text: pageBlocks
          .map((block) => block.content ?? "")
          .filter(Boolean)
          .join("\n"),
        markdown: pageBlocks
          .map((block) => block.content ?? "")
          .filter(Boolean)
          .join("\n\n"),
        layout: { blocks: pageBlocks },
      }))

    return {
      pages,
      usage: {
        pages: data.result?.usage?.num_pages,
        credits: data.result?.usage?.credits,
      },
      raw: data,
    }
  }

  private async request(
    endpoint: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const response = await fetch(`${REDUCTO_API_BASE}${endpoint}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error")
      throw new Error(
        `Reducto API error: ${response.status} ${response.statusText}. ${errorText}`,
      )
    }
    return response
  }
}

type ReductoBlock = {
  type?: string
  content?: string
  bbox?: { page?: number }
}

function normalizeReductoStatus(status: string | undefined): ProviderJobStatus {
  const normalized = (status ?? "").toLowerCase()
  switch (normalized) {
    case "completed":
    case "success":
      return "success"
    case "failed":
      return "failed"
    case "cancelled":
    case "canceled":
      return "canceled"
    case "pending":
    case "idle":
      return "queued"
    default:
      return "processing"
  }
}

/** Convenience factory: `documents(runtime, { provider: reducto() })`. */
export function reducto(options: ReductoProviderOptions = {}): ReductoProvider {
  return new ReductoProvider(options)
}

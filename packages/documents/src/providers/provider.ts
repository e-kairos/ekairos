export type DocumentProviderName = "llamacloud" | "reducto" | (string & {})

export type ProviderResultType = "markdown" | "text"

export type ProviderJobStatus =
  | "queued"
  | "processing"
  | "success"
  | "failed"
  | "canceled"

export interface ProviderJobRef {
  provider: DocumentProviderName
  externalJobId: string
  fileUrl?: string
  requestRaw?: unknown
}

export interface NormalizedParsePage {
  /** 0-based page index. */
  pageIndex: number
  text?: string
  markdown?: string
  layout?: unknown
}

export interface NormalizedParseResult {
  pages: NormalizedParsePage[]
  usage?: { pages?: number; credits?: number }
  raw?: unknown
}

export interface ProviderParseOptions {
  resultType: ProviderResultType
  config?: unknown
}

/**
 * Contract every parse provider implements. The documents API drives the
 * upload → poll → fetch cycle; providers only translate to their REST API and
 * normalize results to pages.
 */
export interface DocumentParseProvider {
  readonly name: DocumentProviderName
  readonly supportedResultTypes: ProviderResultType[]

  uploadAndStartParse(
    file: Buffer,
    filename: string,
    options: ProviderParseOptions,
  ): Promise<ProviderJobRef>

  getStatus(
    externalJobId: string,
  ): Promise<{ status: ProviderJobStatus; error?: string }>

  fetchResult(
    externalJobId: string,
    options?: { resultType?: ProviderResultType },
  ): Promise<NormalizedParseResult>
}

export class ProviderResultNotReadyError extends Error {
  constructor(message?: string) {
    super(message ?? "Provider result not ready")
    this.name = "ProviderResultNotReadyError"
  }
}

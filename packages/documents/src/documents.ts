import { id } from "@instantdb/core"

import { INLINE_PROVIDER, type DocumentStatus } from "./schema.js"
import { llamaCloud } from "./providers/llamacloud.js"
import {
  ProviderResultNotReadyError,
  type DocumentParseProvider,
  type NormalizedParsePage,
  type ProviderResultType,
} from "./providers/provider.js"

/**
 * Minimal runtime contract: anything exposing `db()` works — an
 * `EkairosRuntime`, an events/reactor runtime handle, or a plain object in
 * tests: `{ db: async () => adminDb }`.
 */
export type DocumentsRuntime = {
  db(): Promise<any>
}

export type DocumentFileRef =
  | string
  | { fileId: string }
  | { path: string }

export type DocumentsConfig = {
  /** Parse provider. Defaults to LlamaCloud (requires LLAMA_CLOUD_API_KEY). */
  provider?: DocumentParseProvider
  /** Provider-specific parse configuration forwarded on every job. */
  parseConfig?: unknown
  /** Result flavor requested from the provider. Defaults to "markdown". */
  resultType?: ProviderResultType
  /** Polling interval while a provider job runs. Defaults to 2000ms. */
  pollIntervalMs?: number
  /** Max wall-clock time to wait for a provider job. Defaults to 10 minutes. */
  timeoutMs?: number
}

export type DocumentCreateOptions = {
  /** Display name; defaults to the file's basename. */
  name?: string
  /** Media type override when the $files record doesn't carry one. */
  mediaType?: string
  /** Owner/organization scoping recorded on the document. */
  ownerId?: string
  orgId?: string
  /** Re-formalize even if a ready document already exists for the file. */
  force?: boolean
}

export type DocumentPageContent = {
  index: number
  text: string
  markdown?: string
}

export type DocumentReadResult = {
  documentId: string
  fileId: string | null
  name: string | null
  status: DocumentStatus
  pagesCount: number
  content: string
  truncated: boolean
}

export class DocumentNotReadyError extends Error {
  constructor(
    public readonly documentId: string,
    public readonly status: string,
    detail?: string,
  ) {
    super(
      `Document ${documentId} is not ready (status: ${status})${detail ? `: ${detail}` : ""}`,
    )
    this.name = "DocumentNotReadyError"
  }
}

export class DocumentParseError extends Error {
  constructor(
    public readonly documentId: string,
    message: string,
  ) {
    super(message)
    this.name = "DocumentParseError"
  }
}

/**
 * InstantDB returns has-one links as objects on schema-typed clients and as
 * single-element arrays on untyped clients. Normalize both.
 */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

const PAGE_TX_CHUNK = 50
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_TIMEOUT_MS = 10 * 60_000

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "xml",
  "yaml",
  "yml",
  "html",
  "htm",
])

type FileRecord = {
  id: string
  path?: string
  url?: string
  size?: number
  document?: DocumentRow | DocumentRow[] | null
  [key: string]: unknown
}

type DocumentRow = {
  id: string
  name?: string | null
  mimeType?: string | null
  size?: number | null
  status?: string | null
  provider?: string | null
  pagesCount?: number | null
  error?: string | null
  lastJobId?: string | null
  file?: { id: string } | Array<{ id: string }> | null
  [key: string]: unknown
}

export class DocumentHandle {
  constructor(
    private readonly runtime: DocumentsRuntime,
    private row: DocumentRow,
  ) {}

  get id(): string {
    return this.row.id
  }

  get name(): string | null {
    return this.row.name ?? null
  }

  get mimeType(): string | null {
    return this.row.mimeType ?? null
  }

  get size(): number | null {
    return this.row.size ?? null
  }

  get status(): DocumentStatus {
    return (this.row.status ?? "processing") as DocumentStatus
  }

  get provider(): string | null {
    return this.row.provider ?? null
  }

  get pagesCount(): number {
    return this.row.pagesCount ?? 0
  }

  get error(): string | null {
    return this.row.error ?? null
  }

  get fileId(): string | null {
    return one(this.row.file)?.id ?? null
  }

  /** Ordered page contents. Pass indexes (0-based) to read a subset. */
  async pages(indexes?: number[]): Promise<DocumentPageContent[]> {
    const db = await this.runtime.db()
    const where: Record<string, unknown> = { "document.id": this.row.id }
    if (indexes && indexes.length > 0) {
      where.pageIndex = { $in: indexes }
    }
    const result = await db.query({
      document_pages: {
        $: { where, order: { pageIndex: "asc" } },
      },
    })
    const rows: Array<{
      pageIndex?: number
      text?: string
      markdown?: string
    }> = result.document_pages ?? []
    return rows.map((row, position) => ({
      index: row.pageIndex ?? position,
      text: row.text ?? "",
      markdown: row.markdown ?? undefined,
    }))
  }

  /** Single page content by 0-based index, or null. */
  async page(index: number): Promise<DocumentPageContent | null> {
    const pages = await this.pages([index])
    return pages[0] ?? null
  }

  /**
   * Full formalized content: pages joined in order, markdown preferred over
   * plain text. Throws DocumentNotReadyError unless the document is ready.
   */
  async text(options?: {
    maxChars?: number
    pageSeparator?: string
  }): Promise<string> {
    if (this.status !== "ready") {
      throw new DocumentNotReadyError(this.id, this.status, this.error ?? undefined)
    }
    const pages = await this.pages()
    const separator = options?.pageSeparator ?? "\n\n"
    const joined = pages
      .map((page) => page.markdown || page.text)
      .filter(Boolean)
      .join(separator)
    if (options?.maxChars && joined.length > options.maxChars) {
      return joined.slice(0, options.maxChars)
    }
    return joined
  }

  /** Re-reads the document row (status, pagesCount, error). */
  async refresh(): Promise<this> {
    const db = await this.runtime.db()
    const result = await db.query({
      document_documents: {
        $: { where: { id: this.row.id }, limit: 1 },
        file: {},
      },
    })
    const row = result.document_documents?.[0]
    if (row) this.row = row as DocumentRow
    return this
  }
}

export type DocumentsApi = {
  /**
   * Formalize a file into a document (idempotent). Returns the existing
   * document when one is already ready for the file; otherwise downloads the
   * file, parses it (inline for plain text, via the provider otherwise) and
   * persists the pages.
   */
  create(
    ref: DocumentFileRef,
    options?: DocumentCreateOptions,
  ): Promise<DocumentHandle>

  /** Existing document for a file, or null. Never triggers a parse. */
  get(ref: DocumentFileRef): Promise<DocumentHandle | null>

  /** Document by its own id, or null. */
  getById(documentId: string): Promise<DocumentHandle | null>

  /**
   * Get-or-create + read in one call. This is what model-facing actions use.
   */
  read(
    ref: DocumentFileRef | { documentId: string },
    options?: { pages?: number[]; maxChars?: number },
  ): Promise<DocumentReadResult>
}

export function documents(
  runtime: DocumentsRuntime,
  config: DocumentsConfig = {},
): DocumentsApi {
  return new Documents(runtime, config)
}

class Documents implements DocumentsApi {
  private providerInstance: DocumentParseProvider | null

  constructor(
    private readonly runtime: DocumentsRuntime,
    private readonly config: DocumentsConfig,
  ) {
    this.providerInstance = config.provider ?? null
  }

  async create(
    ref: DocumentFileRef,
    options: DocumentCreateOptions = {},
  ): Promise<DocumentHandle> {
    const db = await this.runtime.db()
    const file = await this.requireFile(db, ref)

    const existing = one(file.document)
    if (existing && existing.status === "ready" && !options.force) {
      return new DocumentHandle(this.runtime, {
        ...existing,
        file: { id: file.id },
      })
    }

    const buffer = await downloadFile(file)
    const name = options.name ?? fileBasename(file) ?? "document"
    const mediaType =
      options.mediaType ?? detectMediaType(file, name) ?? "application/octet-stream"

    const documentId = existing?.id ?? id()
    const now = new Date()

    await db.transact([
      db.tx.document_documents[documentId].update({
        name,
        mimeType: mediaType,
        size: file.size ?? buffer.length,
        status: "processing",
        error: null,
        ownerId: options.ownerId,
        orgId: options.orgId,
        createdAt: existing ? undefined : now,
        updatedAt: now,
      }),
      db.tx.document_documents[documentId].link({ file: file.id }),
    ])

    if (existing) {
      await this.deletePages(db, documentId)
    }

    try {
      if (isTextLike(mediaType, name)) {
        await this.persistPages(db, documentId, null, [
          { pageIndex: 0, text: buffer.toString("utf8") },
        ])
        await db.transact([
          db.tx.document_documents[documentId].update({
            status: "ready",
            provider: INLINE_PROVIDER,
            pagesCount: 1,
            processedAt: new Date(),
            updatedAt: new Date(),
          }),
        ])
      } else {
        await this.parseWithProvider(db, documentId, buffer, name)
      }
    } catch (error) {
      await db.transact([
        db.tx.document_documents[documentId].update({
          status: "failed",
          error: errorMessage(error),
          updatedAt: new Date(),
        }),
      ])
      throw error instanceof DocumentParseError
        ? error
        : new DocumentParseError(documentId, errorMessage(error))
    }

    const handle = new DocumentHandle(this.runtime, {
      id: documentId,
      file: { id: file.id },
    })
    return await handle.refresh()
  }

  async get(ref: DocumentFileRef): Promise<DocumentHandle | null> {
    const db = await this.runtime.db()
    const file = await this.findFile(db, ref)
    const document = one(file?.document)
    if (!file || !document) return null
    return new DocumentHandle(this.runtime, {
      ...document,
      file: { id: file.id },
    })
  }

  async getById(documentId: string): Promise<DocumentHandle | null> {
    const db = await this.runtime.db()
    const result = await db.query({
      document_documents: {
        $: { where: { id: documentId }, limit: 1 },
        file: {},
      },
    })
    const row = result.document_documents?.[0]
    return row ? new DocumentHandle(this.runtime, row as DocumentRow) : null
  }

  async read(
    ref: DocumentFileRef | { documentId: string },
    options: { pages?: number[]; maxChars?: number } = {},
  ): Promise<DocumentReadResult> {
    const handle =
      typeof ref === "object" && ref !== null && "documentId" in ref
        ? await this.getById(ref.documentId)
        : await this.create(ref as DocumentFileRef)

    if (!handle) {
      const documentId =
        typeof ref === "object" && ref !== null && "documentId" in ref
          ? ref.documentId
          : "unknown"
      throw new Error(`Document ${documentId} not found`)
    }

    if (handle.status !== "ready") {
      throw new DocumentNotReadyError(
        handle.id,
        handle.status,
        handle.error ?? undefined,
      )
    }

    const pages = await handle.pages(options.pages)
    const joined = pages
      .map((page) =>
        pages.length > 1
          ? `--- Page ${page.index + 1} ---\n${page.markdown || page.text}`
          : page.markdown || page.text,
      )
      .filter(Boolean)
      .join("\n\n")

    const maxChars = options.maxChars ?? Infinity
    const truncated = joined.length > maxChars
    return {
      documentId: handle.id,
      fileId: handle.fileId,
      name: handle.name,
      status: handle.status,
      pagesCount: handle.pagesCount,
      content: truncated ? joined.slice(0, maxChars) : joined,
      truncated,
    }
  }

  private provider(): DocumentParseProvider {
    if (!this.providerInstance) {
      this.providerInstance = llamaCloud()
    }
    return this.providerInstance
  }

  private async parseWithProvider(
    db: any,
    documentId: string,
    buffer: Buffer,
    filename: string,
  ): Promise<void> {
    const provider = this.provider()
    const resultType = this.config.resultType ?? "markdown"
    const jobId = id()
    const now = new Date()

    await db.transact([
      db.tx.document_jobs[jobId].update({
        provider: provider.name,
        status: "queued",
        config: this.config.parseConfig ?? null,
        resultType,
        createdAt: now,
        updatedAt: now,
      }),
      db.tx.document_jobs[jobId].link({ document: documentId }),
      db.tx.document_documents[documentId].update({
        provider: provider.name,
        lastJobId: jobId,
        updatedAt: now,
      }),
    ])

    try {
      const ref = await provider.uploadAndStartParse(buffer, filename, {
        resultType,
        config: this.config.parseConfig,
      })
      await db.transact([
        db.tx.document_jobs[jobId].update({
          externalJobId: ref.externalJobId,
          externalFileUrl: ref.fileUrl,
          status: "processing",
          updatedAt: new Date(),
        }),
      ])

      await this.waitForJob(provider, ref.externalJobId)

      const result = await this.fetchResultWithRetry(
        provider,
        ref.externalJobId,
        resultType,
      )
      await this.persistPages(db, documentId, jobId, result.pages)

      const completedAt = new Date()
      await db.transact([
        db.tx.document_jobs[jobId].update({
          status: "success",
          pagesCount: result.pages.length,
          creditsUsed: result.usage?.credits,
          completedAt,
          updatedAt: completedAt,
        }),
        db.tx.document_documents[documentId].update({
          status: "ready",
          pagesCount: result.pages.length,
          processedAt: completedAt,
          updatedAt: completedAt,
        }),
      ])
    } catch (error) {
      await db.transact([
        db.tx.document_jobs[jobId].update({
          status: "failed",
          error: errorMessage(error),
          completedAt: new Date(),
          updatedAt: new Date(),
        }),
      ])
      throw new DocumentParseError(documentId, errorMessage(error))
    }
  }

  /**
   * Providers can report a job as successful slightly before its result is
   * materialized. Retry ProviderResultNotReadyError within the poll budget.
   */
  private async fetchResultWithRetry(
    provider: DocumentParseProvider,
    externalJobId: string,
    resultType: ProviderResultType,
  ) {
    const interval = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const startedAt = Date.now()

    while (true) {
      try {
        return await provider.fetchResult(externalJobId, { resultType })
      } catch (error) {
        if (
          !(error instanceof ProviderResultNotReadyError) ||
          Date.now() - startedAt > timeout
        ) {
          throw error
        }
      }
      await sleep(interval)
    }
  }

  private async waitForJob(
    provider: DocumentParseProvider,
    externalJobId: string,
  ): Promise<void> {
    const interval = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const startedAt = Date.now()

    while (true) {
      const status = await provider.getStatus(externalJobId)
      if (status.status === "success") return
      if (status.status === "failed" || status.status === "canceled") {
        throw new Error(
          `${provider.name} parse job ${externalJobId} ${status.status}${status.error ? `: ${status.error}` : ""}`,
        )
      }
      if (Date.now() - startedAt > timeout) {
        throw new Error(
          `${provider.name} parse job ${externalJobId} timed out after ${timeout}ms`,
        )
      }
      await sleep(interval)
    }
  }

  private async persistPages(
    db: any,
    documentId: string,
    jobId: string | null,
    pages: NormalizedParsePage[],
  ): Promise<void> {
    const now = new Date()
    for (let offset = 0; offset < pages.length; offset += PAGE_TX_CHUNK) {
      const chunk = pages.slice(offset, offset + PAGE_TX_CHUNK)
      const transactions = chunk.flatMap((page) => {
        const pageId = id()
        return [
          db.tx.document_pages[pageId].update({
            pageIndex: page.pageIndex,
            text: page.text ?? null,
            markdown: page.markdown ?? null,
            layout: page.layout ?? null,
            createdAt: now,
          }),
          db.tx.document_pages[pageId].link({
            document: documentId,
            ...(jobId ? { job: jobId } : {}),
          }),
        ]
      })
      await db.transact(transactions)
    }
  }

  private async deletePages(db: any, documentId: string): Promise<void> {
    const result = await db.query({
      document_pages: {
        $: { where: { "document.id": documentId } },
      },
    })
    const rows: Array<{ id: string }> = result.document_pages ?? []
    if (rows.length === 0) return
    await db.transact(rows.map((row) => db.tx.document_pages[row.id].delete()))
  }

  private async findFile(
    db: any,
    ref: DocumentFileRef,
  ): Promise<FileRecord | null> {
    const normalized =
      typeof ref === "string" ? { fileId: ref } : (ref as { fileId?: string; path?: string })
    const where = normalized.fileId
      ? { id: normalized.fileId }
      : { path: normalized.path }
    const result = await db.query({
      $files: {
        $: { where, limit: 1 },
        document: {},
      },
    })
    const file = result.$files?.[0]
    return file ? (file as FileRecord) : null
  }

  private async requireFile(db: any, ref: DocumentFileRef): Promise<FileRecord> {
    const file = await this.findFile(db, ref)
    if (!file) {
      throw new Error(`File not found for ref: ${JSON.stringify(ref)}`)
    }
    return file
  }
}

async function downloadFile(file: FileRecord): Promise<Buffer> {
  if (!file.url) {
    throw new Error(`File ${file.id} has no download url`)
  }
  const response = await fetch(file.url)
  if (!response.ok) {
    throw new Error(
      `File ${file.id} download failed: ${response.status} ${response.statusText}`,
    )
  }
  return Buffer.from(await response.arrayBuffer())
}

function fileBasename(file: FileRecord): string | null {
  const path = typeof file.path === "string" ? file.path : null
  if (!path) return null
  const segments = path.split("/")
  return segments[segments.length - 1] || null
}

function detectMediaType(file: FileRecord, name: string): string | null {
  const recorded =
    (file["content-type"] as string | undefined) ??
    (file.contentType as string | undefined) ??
    null
  if (recorded) return recorded

  const extension = name.includes(".")
    ? name.split(".").pop()?.toLowerCase()
    : undefined
  switch (extension) {
    case "pdf":
      return "application/pdf"
    case "txt":
      return "text/plain"
    case "md":
    case "markdown":
      return "text/markdown"
    case "csv":
      return "text/csv"
    case "tsv":
      return "text/tab-separated-values"
    case "json":
    case "jsonl":
      return "application/json"
    case "xml":
      return "application/xml"
    case "html":
    case "htm":
      return "text/html"
    case "png":
      return "image/png"
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    default:
      return null
  }
}

function isTextLike(mediaType: string, name: string): boolean {
  if (mediaType.startsWith("text/")) return true
  if (
    mediaType === "application/json" ||
    mediaType === "application/xml" ||
    mediaType === "application/x-ndjson"
  ) {
    return true
  }
  const extension = name.includes(".")
    ? name.split(".").pop()?.toLowerCase()
    : undefined
  return extension ? TEXT_EXTENSIONS.has(extension) : false
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

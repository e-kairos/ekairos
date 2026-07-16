import { i } from "@instantdb/core"
import { domain } from "@ekairos/domain"

const entities = {
  document_documents: i.entity({
    name: i.string().optional().indexed(),
    mimeType: i.string().optional(),
    size: i.number().optional(),
    status: i.string().optional().indexed(),
    provider: i.string().optional().indexed(),
    pagesCount: i.number().optional(),
    error: i.string().optional(),
    lastJobId: i.string().optional(),
    ownerId: i.string().optional().indexed(),
    orgId: i.string().optional().indexed(),
    createdAt: i.date().optional().indexed(),
    updatedAt: i.date().optional(),
    processedAt: i.date().optional().indexed(),
  }),
  document_jobs: i.entity({
    provider: i.string().optional().indexed(),
    externalJobId: i.string().optional().unique().indexed(),
    externalFileUrl: i.string().optional(),
    status: i.string().optional().indexed(),
    config: i.json().optional(),
    resultType: i.string().optional(),
    error: i.string().optional(),
    pagesCount: i.number().optional(),
    creditsUsed: i.number().optional(),
    createdAt: i.date().optional().indexed(),
    updatedAt: i.date().optional(),
    completedAt: i.date().optional(),
  }),
  document_pages: i.entity({
    pageIndex: i.number().optional().indexed(),
    text: i.string().optional(),
    markdown: i.string().optional(),
    layout: i.json().optional(),
    createdAt: i.date().optional().indexed(),
  }),
  document_sets: i.entity({
    key: i.string().unique().indexed(),
    status: i.string().optional().indexed(),
    createdAt: i.date().optional().indexed(),
    updatedAt: i.date().optional(),
  }),
}

const links = {
  documentFile: {
    forward: {
      on: "document_documents",
      has: "one",
      label: "file",
    },
    reverse: {
      on: "$files",
      has: "one",
      label: "document",
    },
  },
  documentJobs: {
    forward: {
      on: "document_documents",
      has: "many",
      label: "jobs",
    },
    reverse: {
      on: "document_jobs",
      has: "one",
      label: "document",
    },
  },
  documentPages: {
    forward: {
      on: "document_documents",
      has: "many",
      label: "pages",
    },
    reverse: {
      on: "document_pages",
      has: "one",
      label: "document",
      onDelete: "cascade",
    },
  },
  documentJobPages: {
    forward: {
      on: "document_jobs",
      has: "many",
      label: "pages",
    },
    reverse: {
      on: "document_pages",
      has: "one",
      label: "job",
    },
  },
  documentSetDocuments: {
    forward: {
      on: "document_sets",
      has: "many",
      label: "documents",
    },
    reverse: {
      on: "document_documents",
      has: "many",
      label: "sets",
    },
  },
} as const

const rooms = {} as const

export const DOCUMENT_STATUSES = ["processing", "ready", "failed"] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export const DOCUMENT_JOB_STATUSES = [
  "queued",
  "processing",
  "success",
  "failed",
  "canceled",
] as const
export type DocumentJobStatus = (typeof DOCUMENT_JOB_STATUSES)[number]

/**
 * Provider name recorded on documents formalized without an external parse
 * provider (plain-text files persisted directly from their bytes).
 */
export const INLINE_PROVIDER = "inline"

export const documentDomain = domain({
  name: "documents",
  packageName: "@ekairos/documents",
}).schema({ entities, links, rooms })

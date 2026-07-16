/* @vitest-environment node */

import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect } from "vitest"
import { init } from "@instantdb/admin"

import {
  describeInstant,
  destroyDocumentsTestApp,
  itInstant,
  provisionDocumentsTestApp,
} from "./_env.ts"
import { documentDomain } from "../schema.ts"
import {
  DocumentParseError,
  documents,
  type DocumentsRuntime,
} from "../documents.ts"
import { documentActions } from "../actions.ts"
import type {
  DocumentParseProvider,
  NormalizedParseResult,
  ProviderJobRef,
  ProviderJobStatus,
} from "../providers/provider.ts"

function createFakeProvider(params: {
  pages: NormalizedParseResult["pages"]
  failUpload?: boolean
}): DocumentParseProvider {
  return {
    name: "fake",
    supportedResultTypes: ["markdown", "text"],
    async uploadAndStartParse(): Promise<ProviderJobRef> {
      if (params.failUpload) {
        throw new Error("fake provider upload failure")
      }
      return { provider: "fake", externalJobId: `fake-${randomUUID()}` }
    },
    async getStatus(): Promise<{ status: ProviderJobStatus }> {
      return { status: "success" }
    },
    async fetchResult(): Promise<NormalizedParseResult> {
      return { pages: params.pages }
    },
  }
}

describeInstant("@ekairos/documents documents()", () => {
  let appId = ""
  let adminToken = ""
  let db: ReturnType<typeof init>
  let runtime: DocumentsRuntime

  beforeAll(async () => {
    const app = await provisionDocumentsTestApp({
      name: `documents-test-${Date.now()}`,
      schema: documentDomain.instantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
    db = init({ appId, adminToken })
    runtime = { db: async () => db }
  })

  afterAll(async () => {
    await destroyDocumentsTestApp(appId)
  })

  async function uploadFixture(params: {
    name: string
    content: Buffer | string
    contentType: string
  }): Promise<string> {
    const buffer =
      typeof params.content === "string"
        ? Buffer.from(params.content, "utf8")
        : params.content
    const path = `/tests/documents/${Date.now()}-${randomUUID().slice(0, 8)}-${params.name}`
    const uploadResult = await db.storage.uploadFile(path, buffer, {
      contentType: params.contentType,
      contentDisposition: params.name,
    })
    const fileId = (uploadResult as any)?.data?.id as string | undefined
    if (!fileId) throw new Error("test file upload failed")
    return fileId
  }

  itInstant("formalizes a plain-text file inline (no provider)", async () => {
    const content = "hola,mundo\n1,2\n3,4"
    const fileId = await uploadFixture({
      name: "items.csv",
      content,
      contentType: "text/csv",
    })

    const api = documents(runtime, {
      provider: createFakeProvider({ pages: [] }),
    })
    const doc = await api.create(fileId)

    expect(doc.status).toBe("ready")
    expect(doc.provider).toBe("inline")
    expect(doc.pagesCount).toBe(1)
    expect(doc.fileId).toBe(fileId)
    expect(await doc.text()).toBe(content)

    const fetched = await api.get(fileId)
    expect(fetched?.id).toBe(doc.id)

    const again = await api.create(fileId)
    expect(again.id).toBe(doc.id)
  })

  itInstant("formalizes a binary file through the provider", async () => {
    const fileId = await uploadFixture({
      name: "oferta.pdf",
      content: Buffer.from("%PDF-fake"),
      contentType: "application/pdf",
    })

    const api = documents(runtime, {
      provider: createFakeProvider({
        pages: [
          { pageIndex: 0, text: "Primera pagina", markdown: "# Primera pagina" },
          { pageIndex: 1, text: "Segunda pagina", markdown: "## Segunda pagina" },
        ],
      }),
      pollIntervalMs: 10,
    })

    const doc = await api.create(fileId)
    expect(doc.status).toBe("ready")
    expect(doc.provider).toBe("fake")
    expect(doc.pagesCount).toBe(2)

    const pageTwo = await doc.page(1)
    expect(pageTwo?.text).toBe("Segunda pagina")

    const text = await doc.text()
    expect(text).toContain("# Primera pagina")
    expect(text).toContain("## Segunda pagina")

    const jobSnapshot = await db.query({
      document_jobs: {
        $: { where: { "document.id": doc.id } },
      },
    } as any)
    const jobs = (jobSnapshot as any).document_jobs ?? []
    expect(jobs.length).toBe(1)
    expect(jobs[0].status).toBe("success")
    expect(jobs[0].externalJobId).toContain("fake-")
    expect(jobs[0].pagesCount).toBe(2)
  })

  itInstant("marks the document failed when the provider errors", async () => {
    const fileId = await uploadFixture({
      name: "roto.pdf",
      content: Buffer.from("%PDF-fake"),
      contentType: "application/pdf",
    })

    const api = documents(runtime, {
      provider: createFakeProvider({ pages: [], failUpload: true }),
    })

    await expect(api.create(fileId)).rejects.toThrow(DocumentParseError)

    const doc = await api.get(fileId)
    expect(doc?.status).toBe("failed")
    expect(doc?.error).toContain("fake provider upload failure")
  })

  itInstant("document_read action reads pages on demand", async () => {
    const fileId = await uploadFixture({
      name: "pliego.pdf",
      content: Buffer.from("%PDF-fake"),
      contentType: "application/pdf",
    })

    const actions = documentActions(runtime, {
      provider: createFakeProvider({
        pages: [
          { pageIndex: 0, text: "Condiciones generales" },
          { pageIndex: 1, text: "Especificaciones tecnicas" },
          { pageIndex: 2, text: "Anexos" },
        ],
      }),
      pollIntervalMs: 10,
      maxChars: 10_000,
    })

    const result = (await actions.document_read.execute({
      fileId,
      pages: [2],
    })) as any

    expect(result.error).toBeUndefined()
    expect(result.status).toBe("ready")
    expect(result.pagesCount).toBe(3)
    expect(result.content).toContain("Especificaciones tecnicas")
    expect(result.content).not.toContain("Condiciones generales")

    const full = (await actions.document_read.execute({
      documentId: result.documentId,
    })) as any
    expect(full.content).toContain("Condiciones generales")
    expect(full.content).toContain("Anexos")
  })
})

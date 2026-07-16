/* @vitest-environment node */

import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect } from "vitest"
import { init } from "@instantdb/admin"

import {
  describeInstant,
  destroyDocumentsTestApp,
  itLlamaCloud,
  provisionDocumentsTestApp,
} from "./_env.ts"
import { documentDomain } from "../schema.ts"
import { documents, type DocumentsRuntime } from "../documents.ts"
import { llamaCloud } from "../providers/llamacloud.ts"

/**
 * Builds a small but valid single-page PDF containing the given lines of
 * Helvetica text, with a correct xref table.
 */
function buildMinimalPdf(lines: string[]): Buffer {
  const encoder = new TextEncoder()
  const escaped = lines.map((line) =>
    line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"),
  )
  const textOps = escaped
    .map((line, index) => `BT /F1 18 Tf 72 ${700 - index * 28} Td (${line}) Tj ET`)
    .join("\n")
  const stream = textOps

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]

  let body = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(body).length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })

  const xrefOffset = encoder.encode(body).length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(body + xref + trailer, "utf8")
}

describeInstant("@ekairos/documents LlamaCloud live", () => {
  let appId = ""
  let db: ReturnType<typeof init>
  let runtime: DocumentsRuntime

  beforeAll(async () => {
    const app = await provisionDocumentsTestApp({
      name: `documents-llama-${Date.now()}`,
      schema: documentDomain.instantSchema(),
    })
    appId = app.appId
    db = init({ appId, adminToken: app.adminToken })
    runtime = { db: async () => db }
  })

  afterAll(async () => {
    await destroyDocumentsTestApp(appId)
  })

  itLlamaCloud(
    "parses a real PDF end to end",
    async () => {
      const pdf = buildMinimalPdf([
        "Ekairos Documents",
        "Licitacion 4519 - Provision de bombas centrifugas",
        "Cantidad: 12 unidades",
      ])
      const path = `/tests/documents/${Date.now()}-${randomUUID().slice(0, 8)}-licitacion.pdf`
      const uploadResult = await db.storage.uploadFile(path, pdf, {
        contentType: "application/pdf",
        contentDisposition: "licitacion.pdf",
      })
      const fileId = (uploadResult as any)?.data?.id as string
      expect(fileId).toBeTruthy()

      const api = documents(runtime, { provider: llamaCloud() })
      const doc = await api.create(fileId)

      expect(doc.status).toBe("ready")
      expect(doc.provider).toBe("llamacloud")
      expect(doc.pagesCount).toBeGreaterThanOrEqual(1)

      const text = await doc.text()
      expect(text.length).toBeGreaterThan(0)
      expect(text.toLowerCase()).toContain("bombas")

      const read = await api.read({ documentId: doc.id }, { maxChars: 5_000 })
      expect(read.content.toLowerCase()).toContain("licitacion")
    },
    8 * 60 * 1000,
  )
})

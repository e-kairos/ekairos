/* @vitest-environment node */

import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { materializeContextResource } from "../context.local-resources.ts"
import type { StoredContextResource } from "../context.store.ts"

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
}

describe("context local resources", () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ekairos-events-resources-"))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("keeps file resources metadata-only when no file payload or adapter is available", async () => {
    const resource = {
      key: "attachment:missing",
      type: "file",
      name: "Missing payload",
      description: "The file exists in the domain but was not loaded for local materialization.",
      fileId: "file_missing",
      filename: "missing.pdf",
      mediaType: "application/pdf",
    } as StoredContextResource

    const prepared = await materializeContextResource({
      resourcesDir: root,
      resource,
    })

    expect(prepared.status).toBe("metadata_only")
    expect(prepared.reason).toContain("file content")
    expect(prepared.files).toHaveLength(0)

    const metadata = await readJson(prepared.metadataPath)
    expect((metadata.local as Record<string, unknown>).status).toBe("metadata_only")
  })

  it("materializes inline file payloads without leaking inline content into metadata", async () => {
    const resource = {
      key: "attachment:inline",
      type: "file",
      name: "Inline payload",
      description: "Inline test file.",
      fileId: "file_inline",
      filename: "inline.csv",
      mediaType: "text/csv",
      contentBase64: Buffer.from("code,quantity\nINLINE,9\n").toString("base64"),
      content: "this must not be written into metadata",
    } as unknown as StoredContextResource

    const prepared = await materializeContextResource({
      resourcesDir: root,
      resource,
    })

    expect(prepared.status).toBe("materialized")
    expect(await readFile(prepared.files[0]!.path, "utf8")).toContain("INLINE")

    const metadata = await readJson(prepared.metadataPath)
    expect(metadata.contentBase64).toBeUndefined()
    expect(metadata.content).toBeUndefined()
    expect((metadata.local as Record<string, unknown>).files).toHaveLength(1)
  })

  it("materializes text-like resources as simple local payload files", async () => {
    const textResource = {
      key: "mail-body",
      type: "text",
      name: "Mail body",
      description: "Inbound body.",
      text: "Factura OC 4400131133",
    } as unknown as StoredContextResource
    const datasetResource = {
      key: "dataset:rows",
      type: "dataset",
      name: "Rows",
      description: "JSONL rows.",
      datasetId: "dataset_1",
      jsonl: "{\"type\":\"row\"}\n",
    } as unknown as StoredContextResource

    const text = await materializeContextResource({ resourcesDir: root, resource: textResource })
    const dataset = await materializeContextResource({
      resourcesDir: root,
      resource: datasetResource,
    })

    expect(text.status).toBe("materialized")
    expect(dataset.status).toBe("materialized")
    expect(await readFile(join(text.dir, "content.txt"), "utf8")).toContain("Factura OC")
    expect(await readFile(join(dataset.dir, "data.jsonl"), "utf8")).toContain("\"row\"")
    expect(await exists(text.metadataPath)).toBe(true)
    expect(await exists(dataset.metadataPath)).toBe(true)
  })
})

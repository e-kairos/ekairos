/* @vitest-environment node */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  ContextHandle,
  contextDomain,
  prepareContextLocal,
  prepareExecutionLocal,
  prepareStepPartLocal,
  type ContextItem,
  type StoredContext,
} from "../index.ts"
import {
  destroyContextTestApp,
  describeInstant,
  provisionContextTestApp,
  itInstant,
} from "./_env.ts"
import { EventsTestRuntime } from "./context.test-runtime.ts"

type TestContextContent = {
  orgId: string
  process: string
}

function createTriggerEvent(): ContextItem {
  return {
    id: randomUUID(),
    type: "input",
    channel: "email",
    createdAt: new Date("2026-06-21T12:00:00.000Z").toISOString(),
    content: {
      subject: "Factura OC 4400131133",
      parts: [
        {
          type: "message",
          content: {
            text: "Adjunto factura para la OC 4400131133.",
          },
        },
        {
          type: "message",
          content: {
            blocks: [
              {
                type: "file",
                fileId: "file_invoice_pdf",
                filename: "Factura 00009-00021351.pdf",
                mediaType: "application/pdf",
              },
            ],
          },
        },
      ],
    },
  }
}

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

function preserveTestArtifacts() {
  return String(process.env.EKAIROS_EVENTS_TEST_PERSIST ?? "").toLowerCase() === "true"
}

async function cleanupTestRoot(root: string) {
  if (preserveTestArtifacts()) {
    console.info(`[context-materialization-test] preserved filesystem root: ${root}`)
    return
  }

  await rm(root, { recursive: true, force: true })
}

function isInside(parent: string, child: string) {
  const rel = relative(parent, child)
  return rel === "" || (Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function readRows(queryResult: unknown, key: string): Record<string, unknown>[] {
  const root = asRecord(queryResult)
  if (!root) return []
  const rows = root[key]
  return Array.isArray(rows) ? rows as Record<string, unknown>[] : []
}

function readString(value: unknown, key: string): string | null {
  const record = asRecord(value)
  const raw = record?.[key]
  if (typeof raw === "string") return raw
  if (typeof raw === "number") return String(raw)
  return null
}

describe("context local materialization", () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ekairos-events-local-"))
  })

  afterAll(async () => {
    await cleanupTestRoot(root)
  })

  it("materializes resources and executions with context-first paths", async () => {
    const context: StoredContext<TestContextContent> = {
      id: "context/local-materialization:test",
      key: "accounting-document:email:local",
      status: "open_idle",
      createdAt: new Date("2026-06-21T12:00:00.000Z"),
      content: {
        orgId: "org_disal_test",
        process: "accounting_document.import",
      },
      resources: [
        {
          key: "email/attachment:invoice-pdf",
          type: "file",
          name: "Factura PDF",
          description: "Received invoice attachment.",
          role: "trigger_attachment",
          fileId: "file_invoice_pdf",
          filename: "Factura 00009-00021351.pdf",
          mediaType: "application/pdf",
          contentBase64: Buffer.from("%PDF-1.4\n%ekairos-test\n").toString("base64"),
        } as any,
        {
          key: "mail-body",
          type: "text",
          name: "Mail body",
          description: "Inbound accounting document email.",
          text: "Factura OC 4400131133",
        } as any,
        {
          key: "repo:esolbay/platform",
          type: "repository",
          name: "Esolbay platform",
          description: "Application code repository.",
          repository: "Esolbay-SAS/esolbay-platform",
          ref: "feature/esb-375",
        },
      ],
    }

    const prepared = await prepareContextLocal({
      basePath: root,
      context,
    })

    const invoiceResource = prepared.resources.find(
      (resource) => resource.key === "email/attachment:invoice-pdf",
    )
    expect(invoiceResource?.status).toBe("materialized")
    expect(invoiceResource?.files).toHaveLength(1)
    expect(invoiceResource?.files[0]?.path).toContain(join("resources", "email_attachment_invoice-pdf", "files", "file_invoice_pdf"))
    expect(await readFile(invoiceResource!.files[0]!.path, "utf8")).toContain("%PDF-1.4")

    const repositoryResource = prepared.resources.find(
      (resource) => resource.key === "repo:esolbay/platform",
    )
    expect(repositoryResource?.repositoryDir).toContain(join("resources", "repo_esolbay_platform", "repository"))
    expect(await exists(repositoryResource!.repositoryDir!)).toBe(true)

    const manifest = await readJson(prepared.manifestPath)
    expect(manifest.contextId).toBe(context.id)
    expect(manifest.resourcesDir).toBe(prepared.resourcesDir)
    expect((manifest.resources as unknown[])).toHaveLength(3)

    const execution = await prepareExecutionLocal({
      basePath: root,
      context,
      executionId: "execution/reconcile:001",
      triggerEventId: "event_trigger_001",
      reactionEventId: "event_reaction_001",
    })
    expect(await exists(execution.scriptsDir)).toBe(true)
    expect(await exists(execution.outputDir)).toBe(true)
    expect(await exists(execution.tmpDir)).toBe(true)

    const part = await prepareStepPartLocal({
      basePath: root,
      contextId: context.id,
      executionId: "execution/reconcile:001",
      stepId: "step/reconcile:0",
      partId: "part/action:match",
      metadata: { kind: "action", actionName: "matchAccountingDocument" },
    })
    expect(part.root).toContain(join("steps", "step_reconcile_0", "parts", "part_action_match"))
    expect((await readJson(part.metadataPath)).actionName).toBe("matchAccountingDocument")
  })

  it("is idempotent for repeated materialization", async () => {
    const context: StoredContext<TestContextContent> = {
      id: "context/idempotent",
      key: "context:idempotent",
      status: "open_idle",
      createdAt: new Date(),
      content: { orgId: "org", process: "test" },
      resources: [
        {
          key: "file:source",
          type: "file",
          name: "Source",
          description: "Source file.",
          fileId: "file_source",
          filename: "source.csv",
          content: "code,quantity\nITEM-001,3\n",
        } as any,
      ],
    }

    const first = await prepareContextLocal({ basePath: root, context })
    const second = await prepareContextLocal({ basePath: root, context })

    expect(first.root).toBe(second.root)
    expect(await readFile(first.resources[0]!.files[0]!.path, "utf8")).toContain("ITEM-001")
  })

  it("materializes file resources through callbacks and repository resources through a repository materializer", async () => {
    const context: StoredContext<TestContextContent> = {
      id: "context/callbacks",
      key: "context:callbacks",
      status: "open_idle",
      createdAt: new Date(),
      content: { orgId: "org", process: "test" },
      resources: [
        {
          key: "attachment:from-store",
          type: "file",
          name: "Stored file",
          description: "File content is loaded by adapter callback.",
          fileId: "stored_file_1",
          filename: "stored.csv",
          mediaType: "text/csv",
        } as any,
        {
          key: "repo:fixture",
          type: "repository",
          name: "Fixture repository",
          description: "Repository content is delegated to the adapter.",
          repository: "e-kairos/fixture",
          ref: "main",
        },
      ],
    }

    const prepared = await prepareExecutionLocal({
      basePath: root,
      context,
      executionId: "execution-with-callbacks",
      readFile: (resource) =>
        resource.key === "attachment:from-store"
          ? {
            fileId: "stored_file_1",
            filename: "stored.csv",
            mediaType: "text/csv",
            content: "code,quantity\nCALLBACK,5\n",
          }
          : null,
      materializeRepository: async (_resource, repositoryDir) => {
        await mkdir(join(repositoryDir, ".git"), { recursive: true })
        await writeFile(join(repositoryDir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8")
        await writeFile(join(repositoryDir, "README.md"), "# Fixture\n", "utf8")
      },
    })

    const contextManifest = await readJson(
      join(root, "contexts", "context_callbacks", "manifest.json"),
    )
    const resources = contextManifest.resources as Array<Record<string, unknown>>
    expect(resources.map((resource) => resource.status)).toEqual(["materialized", "materialized"])
    expect(await readFile(
      join(
        root,
        "contexts",
        "context_callbacks",
        "resources",
        "attachment_from-store",
        "files",
        "stored_file_1",
        "stored.csv",
      ),
      "utf8",
    )).toContain("CALLBACK")
    expect(await readFile(
      join(
        root,
        "contexts",
        "context_callbacks",
        "resources",
        "repo_fixture",
        "repository",
        ".git",
        "HEAD",
      ),
      "utf8",
    )).toContain("refs/heads/main")
    expect(await exists(prepared.outputDir)).toBe(true)
  })

  it("keeps traversal-like context, resource, file, execution, step, and part ids inside the base path", async () => {
    const context: StoredContext<TestContextContent> = {
      id: "../../context:escape",
      key: "context:escape",
      status: "open_idle",
      createdAt: new Date(),
      content: { orgId: "org", process: "test" },
      resources: [
        {
          key: "../resources:escape",
          type: "file",
          name: "Escaped",
          description: "Traversal-like ids must be treated as labels.",
          fileId: "../../file:escape",
          filename: "../../invoice.pdf",
          content: "safe",
        } as any,
      ],
    }

    const prepared = await prepareContextLocal({ basePath: root, context })
    const execution = await prepareExecutionLocal({
      basePath: root,
      context,
      executionId: "../execution:escape",
    })
    const part = await prepareStepPartLocal({
      basePath: root,
      contextId: context.id,
      executionId: "../execution:escape",
      stepId: "../step:escape",
      partId: "../part:escape",
    })

    const allPaths = [
      prepared.root,
      prepared.resources[0]!.dir,
      prepared.resources[0]!.files[0]!.path,
      execution.root,
      execution.outputDir,
      part.root,
      part.metadataPath,
    ]

    for (const path of allPaths) {
      expect(isInside(root, path)).toBe(true)
    }
    expect(await readFile(prepared.resources[0]!.files[0]!.path, "utf8")).toBe("safe")
  })
})

describeInstant("context handles + local materialization + Instant runtime", () => {
  let appId: string | null = null
  let adminToken: string | null = null
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ekairos-events-instant-"))
    const app = await provisionContextTestApp({
      name: `context-materialization-${Date.now()}`,
      schema: contextDomain.toInstantSchema(),
    })
    appId = app.appId
    adminToken = app.adminToken
  }, 5 * 60 * 1000)

  afterAll(async () => {
    await cleanupTestRoot(root)
    if (appId && process.env.APP_TEST_PERSIST !== "true") {
      await destroyContextTestApp(appId)
    }
  }, 5 * 60 * 1000)

  itInstant("creates context, events, execution, step parts, and filesystem scaffold", async () => {
    const runtime = new EventsTestRuntime({
      appId: String(appId),
      adminToken: String(adminToken),
      orgId: "org_disal_context_tests",
    })

    const context = await ContextHandle.create<TestContextContent>(runtime, {
      key: `accounting-document:email:${Date.now()}`,
      content: {
        orgId: "org_disal_context_tests",
        process: "accounting_document.import",
      },
      description: "Import a supplier accounting document from one received email.",
      goal: "Extract the document, reconcile with the order, and prepare the ERP request.",
      resources: [
        {
          key: "trigger-email-attachment",
          type: "file",
          name: "Invoice attachment",
          description: "Original attachment from the inbound email.",
          fileId: "file_invoice_pdf",
          filename: "Factura 00009-00021351.pdf",
          mediaType: "application/pdf",
          contentBase64: Buffer.from("%PDF-1.4\n%invoice-test\n").toString("base64"),
        } as any,
      ],
      reactor: {
        kind: "codex",
        state: { workspace: "local" },
      },
    })

    const trigger = await context.input(createTriggerEvent())
    const opened = await context.openExecution({ triggerEvent: trigger })
    const step = await context.createStep({
      executionId: opened.execution.id,
      iteration: 0,
    })
    await context.saveStepParts({
      stepId: step.id,
      parts: [
        {
          type: "message",
          content: {
            text: "Reconciling invoice against order.",
          },
        },
        {
          type: "action",
          content: {
            actionName: "matchAccountingDocument",
            actionCallId: "call_match_1",
            status: "started",
            input: {
              orderCode: "4400131133",
              accountingDocumentId: "doc_test",
            },
          },
        },
      ],
    })

    const preparedContext = await context.prepareLocal({ basePath: root })
    const preparedExecution = await context.prepareExecutionLocal({
      basePath: root,
      executionId: opened.execution.id,
      triggerEventId: opened.trigger.id,
      reactionEventId: opened.reaction.id,
    })
    const preparedPart = await context.preparePartLocal({
      basePath: root,
      executionId: opened.execution.id,
      stepId: step.id,
      partId: "call_match_1",
      metadata: { actionName: "matchAccountingDocument" },
    })

    expect(preparedContext.root).toContain(join("contexts", context.id.replace(/[<>:\"/\\|?*\x00-\x1F]/g, "_")))
    expect(preparedContext.resources[0]?.status).toBe("materialized")
    expect(await readFile(preparedContext.resources[0]!.files[0]!.path, "utf8")).toContain(
      "%invoice-test",
    )
    expect(await exists(preparedExecution.manifestPath)).toBe(true)
    expect(await exists(preparedExecution.stepsDir)).toBe(true)
    expect(preparedPart.root).toContain(join("steps", step.id, "parts", "call_match_1"))

    const executionManifest = await readJson(preparedExecution.manifestPath)
    expect(executionManifest.triggerEventId).toBe(opened.trigger.id)
    expect(executionManifest.reactionEventId).toBe(opened.reaction.id)

    const db = await runtime.db()
    const executionSnapshot = await db.query({
      event_executions: {
        $: { where: { id: opened.execution.id }, limit: 1 },
        context: {},
        input: {},
        output: {},
        steps: {},
      },
    })
    const executionRow = readRows(executionSnapshot, "event_executions")[0]
    expect(readString(executionRow, "status")).toBe("executing")
    expect(readString(asRecord(executionRow)?.context, "id")).toBe(context.id)
    expect(readString(asRecord(executionRow)?.input, "id")).toBe(opened.trigger.id)
    expect(readString(asRecord(executionRow)?.output, "id")).toBe(opened.reaction.id)
    expect((asRecord(executionRow)?.steps as unknown[])).toHaveLength(1)

    const partsSnapshot = await db.query({
      event_parts: {
        $: {
          where: { stepId: step.id },
          limit: 10,
          order: { idx: "asc" },
        },
      },
    })
    const partRows = readRows(partsSnapshot, "event_parts")
    expect(partRows).toHaveLength(2)
    expect(readString(partRows[0], "key")).toBe(`${step.id}:0`)
    expect(readString(partRows[1], "key")).toBe(`${step.id}:1`)
    expect(readString(partRows[0], "type")).toBe("message")
    expect(readString(partRows[1], "type")).toBe("action")
  }, 5 * 60 * 1000)
})

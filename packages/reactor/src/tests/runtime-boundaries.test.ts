import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const reactorRoot = new URL("../../", import.meta.url)
const workspaceRoot = new URL("../../../../", import.meta.url)

async function readProjectFile(path: string) {
  return await readFile(new URL(path, workspaceRoot), "utf8")
}

describe("Reactor runtime boundaries", () => {
  it("does not depend on tasks for approval or human intervention", async () => {
    const [source, manifest] = await Promise.all([
      readFile(new URL("src/reactor.ts", reactorRoot), "utf8"),
      readFile(new URL("package.json", reactorRoot), "utf8"),
    ])

    expect(source).not.toContain("@ekairos/tasks")
    expect(manifest).not.toContain("@ekairos/tasks")
    expect(source).not.toMatch(/\bapproval\s*\(/)
    expect(source).not.toMatch(/\brequestActionApproval\b/)
    expect(source).not.toMatch(/\bapproval\?:/)
  })

  it("keeps approvals out of the Context persistence contract", async () => {
    const files = await Promise.all([
      readProjectFile("packages/events/src/schema.ts"),
      readProjectFile("packages/events/src/context.store.ts"),
      readProjectFile("packages/events/src/stores/instant.store.ts"),
      readProjectFile("packages/events/src/index.ts"),
    ])
    const source = files.join("\n")

    expect(source).not.toContain("context_approvals")
    expect(source).not.toMatch(/\bContextApproval\b/)
    expect(source).not.toMatch(/\bcreateApproval\b/)
    expect(source).not.toMatch(/\bdecideApproval\b/)
    expect(source).not.toMatch(/\bgetApproval\b/)
  })
})

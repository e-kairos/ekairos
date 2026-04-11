import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { buildWorkflowTests } from "@workflow/vitest"

export async function setup() {
  await rm(resolve(process.cwd(), ".workflow-data"), { recursive: true, force: true })
  await buildWorkflowTests()
}

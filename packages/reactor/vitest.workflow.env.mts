import { afterAll } from "vitest"
import { setupWorkflowTests, teardownWorkflowTests } from "@workflow/vitest"

await setupWorkflowTests()

afterAll(async () => {
  await teardownWorkflowTests()
})

import { defineConfig } from "vitest/config"
import { workflow } from "@workflow/vitest"

export default defineConfig({
  plugins: [workflow()],
  test: {
    environment: "node",
    testTimeout: 6 * 60 * 1000,
    hookTimeout: 6 * 60 * 1000,
    reporters: ["default"],
    include: ["src/tests/**/*.workflow.integration.test.ts"],
    globalSetup: ["./vitest.workflow.setup.mts"],
    setupFiles: ["./vitest.workflow.env.mts"],
  },
})

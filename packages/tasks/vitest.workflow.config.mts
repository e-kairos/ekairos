import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"
import { workflow } from "@workflow/vitest"
import { defineConfig } from "vitest/config"

const workspaceRoot = resolve(process.cwd(), "..", "..")
dotenvConfig({ path: resolve(workspaceRoot, ".env.local"), quiet: true })
dotenvConfig({ path: resolve(workspaceRoot, ".env"), quiet: true })

export default defineConfig({
  plugins: [workflow()],
  resolve: {
    alias: [
      { find: "@ekairos/domain", replacement: resolve(__dirname, "..", "domain", "src", "index.ts") },
      { find: "@ekairos/tasks", replacement: resolve(__dirname, "src", "index.ts") },
    ],
  },
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ["default"],
    include: ["src/tests/**/*.workflow.integration.test.ts"],
    globalSetup: ["./vitest.workflow.setup.mts"],
    setupFiles: ["./vitest.workflow.env.mts"],
  },
})

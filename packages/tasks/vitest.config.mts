import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: [
      { find: "@ekairos/domain", replacement: resolve(__dirname, "..", "domain", "src", "index.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/tests/**/*.workflow.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ["default"],
  },
})

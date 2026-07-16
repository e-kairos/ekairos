import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
    reporters: ["default"],
    include: ["src/tests/**/*.test.ts"],
  },
})

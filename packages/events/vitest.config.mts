import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 6 * 60 * 1000,
    hookTimeout: 6 * 60 * 1000,
    reporters: ["default"],
    include: ["src/tests/**/*.test.ts"],
    exclude: [
      "tests/playwright/**",
      "src/tests/**/*.workflow.integration.test.ts",
      "src/tests/context.ai-sdk-chunk-map.test.ts",
      "src/tests/context.ai-sdk-reactor*.test.ts",
      "src/tests/context.builder-contract.test.ts",
      "src/tests/context.output-parts.instant.test.ts",
      "src/tests/context.reactor-params.test.ts",
      "src/tests/context.scripted-reactor.instant.test.ts",
      "src/tests/tools-to-model-tools.test.ts",
    ],
  },
})


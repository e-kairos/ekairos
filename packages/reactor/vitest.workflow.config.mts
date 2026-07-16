import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { defineConfig } from "vitest/config"

async function importWorkflowDependency<T>(specifier: string): Promise<T> {
  const require = createRequire(import.meta.url)
  const vitestEntry = require.resolve("@workflow/vitest")
  const packageRoot = join(vitestEntry, "..", "..")
  const nodeModulesRoot = join(packageRoot, "..", "..")
  return await import(pathToFileURL(join(nodeModulesRoot, specifier, "dist", "index.js")).href) as T
}

const { workflowTransformPlugin } = await importWorkflowDependency<
  typeof import("@workflow/rollup")
>("@workflow/rollup")

export default defineConfig({
  plugins: [
    workflowTransformPlugin({
      exclude: [join(process.cwd(), ".workflow-vitest") + "/"],
    }),
  ],
  test: {
    environment: "node",
    testTimeout: 6 * 60 * 1000,
    hookTimeout: 6 * 60 * 1000,
    include: ["src/tests/**/*.workflow.integration.test.ts"],
    globalSetup: ["./vitest.workflow.setup.mts"],
    setupFiles: ["./vitest.workflow.env.mts"],
  },
})

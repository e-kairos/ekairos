import { defineConfig } from "vitest/config"
import { resolve } from "node:path"
import { join } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { config as dotenvConfig } from "dotenv"

const workspaceRoot = resolve(process.cwd(), "..", "..", "..")
dotenvConfig({ path: resolve(workspaceRoot, ".env.local"), quiet: true })
dotenvConfig({ path: resolve(workspaceRoot, ".env"), quiet: true })

async function importWorkflowVitestDependency<T>(specifier: string): Promise<T> {
  const require = createRequire(import.meta.url)
  const vitestEntry = require.resolve("@workflow/vitest")
  const packageRoot = join(vitestEntry, "..", "..")
  const nodeModulesRoot = join(packageRoot, "..", "..")
  const target = join(nodeModulesRoot, specifier, "dist", "index.js")
  return (await import(pathToFileURL(target).href)) as T
}

const { workflowTransformPlugin } = await importWorkflowVitestDependency<
  typeof import("@workflow/rollup")
>("@workflow/rollup")

export default defineConfig({
  ssr: {
    external: ["workflow/api", "@mongodb-js/zstd"],
  },
  plugins: [
    workflowTransformPlugin({
      exclude: [join(process.cwd(), ".workflow-vitest") + "/"],
    }),
  ],
  test: {
    environment: "node",
    testTimeout: 6 * 60 * 1000,
    hookTimeout: 6 * 60 * 1000,
    reporters: ["default"],
    include: ["src/tests/**/*.workflow.integration.test.ts"],
    fileParallelism: false,
    globalSetup: ["./vitest.workflow.setup.mts"],
    setupFiles: ["./vitest.workflow.env.mts"],
  },
})

import { createRequire } from "node:module"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

async function importWorkflowDependency<T>(specifier: string): Promise<T> {
  const require = createRequire(import.meta.url)
  const vitestEntry = require.resolve("@workflow/vitest")
  const packageRoot = join(vitestEntry, "..", "..")
  const nodeModulesRoot = join(packageRoot, "..", "..")
  return await import(pathToFileURL(join(nodeModulesRoot, specifier, "dist", "index.js")).href) as T
}

export async function setup() {
  const [{ BaseBuilder, createBaseBuilderConfig }, { initDataDir }] = await Promise.all([
    importWorkflowDependency<typeof import("@workflow/builders")>("@workflow/builders"),
    importWorkflowDependency<typeof import("@workflow/world-local")>("@workflow/world-local"),
  ])

  class ReactorWorkflowBuilder extends BaseBuilder {
    constructor(workingDir: string, private readonly outDir: string) {
      super({
        ...createBaseBuilderConfig({
          workingDir,
          dirs: ["src/tests/workflow"],
        }),
        buildTarget: "next",
        suppressCreateWorkflowsBundleLogs: true,
        suppressCreateWebhookBundleLogs: true,
        suppressCreateManifestLogs: true,
      })
    }

    get shouldLogBaseBuilderInfo() {
      return false
    }

    async build() {
      await mkdir(this.outDir, { recursive: true })
      await this.createCombinedBundle({
        stepsOutfile: join(this.outDir, "__step_registrations.mjs"),
        flowOutfile: join(this.outDir, "combined.mjs"),
        externalizeNonSteps: true,
        bundleTransitiveLocalStepDependencies: true,
        bundleFinalOutput: false,
        format: "esm",
        inputFiles: await this.getInputFiles(),
      })
    }
  }

  const cwd = process.cwd()
  await new ReactorWorkflowBuilder(cwd, join(cwd, ".workflow-vitest")).build()
  await initDataDir(join(cwd, ".workflow-data"))
}

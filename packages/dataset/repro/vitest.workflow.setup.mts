import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

async function importWorkflowVitestDependency<T>(specifier: string): Promise<T> {
  const require = createRequire(import.meta.url)
  const vitestEntry = require.resolve("@workflow/vitest")
  const packageRoot = join(vitestEntry, "..", "..")
  const nodeModulesRoot = join(packageRoot, "..", "..")
  const target = join(nodeModulesRoot, specifier, "dist", "index.js")
  return (await import(pathToFileURL(target).href)) as T
}

export async function setup() {
  const [{ BaseBuilder, createBaseBuilderConfig }, { initDataDir }] = await Promise.all([
    importWorkflowVitestDependency<typeof import("@workflow/builders")>(
      "@workflow/builders",
    ),
    importWorkflowVitestDependency<typeof import("@workflow/world-local")>(
      "@workflow/world-local",
    ),
  ])

  class DatasetReproWorkflowBuilder extends BaseBuilder {
    constructor(
      workingDir: string,
      private readonly outDir: string,
    ) {
      super({
        ...createBaseBuilderConfig({
          workingDir,
          dirs: ["repro/workflow"],
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
      const inputFiles = await this.getInputFiles()
      await mkdir(this.outDir, { recursive: true })
      await this.createCombinedBundle({
        stepsOutfile: join(this.outDir, "__step_registrations.mjs"),
        flowOutfile: join(this.outDir, "combined.mjs"),
        externalizeNonSteps: true,
        bundleTransitiveLocalStepDependencies: true,
        bundleFinalOutput: false,
        format: "esm",
        inputFiles,
      })
    }
  }

  const cwd = process.cwd()
  const outDir = join(cwd, ".workflow-vitest")
  const builder = new DatasetReproWorkflowBuilder(cwd, outDir)
  await builder.build()
  const dataDir = join(cwd, ".workflow-data")
  await rm(dataDir, { recursive: true, force: true })
  await initDataDir(dataDir)
}

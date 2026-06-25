import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { config as dotenvConfig } from "dotenv"

async function importWorkflowVitestDependency<T>(specifier: string): Promise<T> {
  const require = createRequire(import.meta.url)
  const vitestEntry = require.resolve("@workflow/vitest")
  const packageRoot = join(vitestEntry, "..", "..")
  const nodeModulesRoot = join(packageRoot, "..", "..")
  const target = join(nodeModulesRoot, specifier, "dist", "index.js")
  return (await import(pathToFileURL(target).href)) as T
}

export async function setup() {
  const workspaceRoot = resolve(process.cwd(), "..", "..", "..")
  dotenvConfig({ path: resolve(workspaceRoot, ".env.local"), quiet: true })
  dotenvConfig({ path: resolve(workspaceRoot, ".env"), quiet: true })

  const [{ BaseBuilder, createBaseBuilderConfig }, { initDataDir }] =
    await Promise.all([
      importWorkflowVitestDependency<typeof import("@workflow/builders")>(
        "@workflow/builders",
      ),
      importWorkflowVitestDependency<typeof import("@workflow/world-local")>(
        "@workflow/world-local",
      ),
    ])

  class OpenAiReactorVitestWorkflowBuilder extends BaseBuilder {
    constructor(
      workingDir: string,
      private readonly outDir: string,
    ) {
      super({
        ...createBaseBuilderConfig({
          workingDir,
          dirs: ["src/tests"],
        }),
        buildTarget: "next",
        suppressCreateWorkflowsBundleLogs: true,
        suppressCreateWebhookBundleLogs: true,
        suppressCreateManifestLogs: true,
        externalPackages: ["workflow/api", "@mongodb-js/zstd"],
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
  const builder = new OpenAiReactorVitestWorkflowBuilder(cwd, outDir)
  await builder.build()
  await initDataDir(join(cwd, ".workflow-data"))
}

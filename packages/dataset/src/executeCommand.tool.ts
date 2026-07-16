import { defineAction, type DomainActionDefinition } from "@ekairos/domain"
import { z } from "zod"

import { materializeDatasetSourcesStep } from "./sourceMaterialization.js"
import { getDatasetScriptsDir, getDatasetStandardDirs } from "./datasetFiles.js"
import { getContextSessionWorkspaceDirs } from "./contextWorkspace.js"
import {
  runDatasetSandboxCommandStep,
  writeDatasetSandboxTextFilesStep,
} from "./sandbox/steps.js"

const MAX_STDOUT_CHARS = 20000
const MAX_STDERR_CHARS = 5000

function normalizeScriptName(scriptName: string): string {
  const normalized = String(scriptName ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80)
  return normalized || "script"
}

function stableScriptHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export const datasetSourceInputSchema = z
  .object({
    key: z.string(),
    kind: z.enum(["file", "text", "dataset", "query"]),
    name: z.string(),
    description: z.string(),
  })
  .passthrough()

export const executeCommandInputSchema = z.object({
  datasetId: z.string(),
  sandboxId: z.string(),
  contextId: z.string().optional(),
  sessionId: z.string().optional(),
  sources: z.array(datasetSourceInputSchema).optional(),
  commandDescription: z
    .string()
    .min(1)
    .describe(
      "Required pre-execution description of the command. Describe the sources it will use, the operation it will perform, the expected output, and why a command is the right tool instead of direct completion.",
    ),
  pythonCode: z
    .string()
    .describe(
      "Python code to execute. Saved to a file before running. Use print() for concise progress and results. If dataset sources are materialized, read os.environ['EKAIROS_DATASET_SOURCES_MANIFEST'] to discover files and metadata. Do not install packages, download dependencies, or access the network.",
    ),
  scriptName: z
    .string()
    .describe(
      "Name for the script file in snake_case (e.g., 'inspect_file', 'parse_csv', 'generate_dataset'). A deterministic suffix will be appended automatically.",
    ),
  sourceKeys: z
    .array(z.string())
    .optional()
    .describe("Optional source keys to materialize before running the script. Omit to materialize every source."),
})

export const materializedSourceSchema = z.object({
  key: z.string(),
  kind: z.string(),
  status: z.string(),
  dir: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      role: z.string(),
      mediaType: z.string().optional(),
    }),
  ),
  reason: z.string().optional(),
})

export const executeCommandOutputSchema = z
  .object({
    success: z.boolean(),
    fatal: z.boolean().optional(),
    status: z.string().optional(),
    exitCode: z.number().optional(),
    stdout: z.string(),
    stderr: z.string(),
    scriptPath: z.string(),
    message: z.string().optional(),
    error: z.string().optional(),
    sourcesDir: z.string().optional(),
    sourcesManifestPath: z.string().optional(),
    materializedSources: z.array(materializedSourceSchema).optional(),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
    stdoutOriginalLength: z.number(),
    stderrOriginalLength: z.number(),
  })
  .passthrough()

export const executeCommand: DomainActionDefinition<
  typeof executeCommandInputSchema,
  typeof executeCommandOutputSchema
> = defineAction({
    description:
      "Execute Python in the sandbox only when deterministic inspection, parsing, aggregation, joins, or computation over dataset sources is required. Requested sources are materialized explicitly under /tmp/ekairos/contexts/{contextId}/sources. The process receives EKAIROS_DATASET_SOURCES_DIR and EKAIROS_DATASET_SOURCES_MANIFEST. Do not install packages, download dependencies, or access the network.",
    input: executeCommandInputSchema,
    output: executeCommandOutputSchema,
    execute: async ({ input, runtime }) => {
      const {
        datasetId,
        sandboxId,
        contextId,
        sessionId,
        sources,
        commandDescription,
        pythonCode,
        sourceKeys,
        scriptName,
      } = input
      const normalizedScriptName = normalizeScriptName(scriptName)
      const scriptHash = stableScriptHash(`${normalizedScriptName}\0${pythonCode}`)
      const scriptsDir =
        contextId && sessionId
          ? getContextSessionWorkspaceDirs({ contextId, sessionId }).scriptsDir
          : getDatasetScriptsDir(datasetId)
      const scriptFile = `${scriptsDir}/${normalizedScriptName}-${scriptHash}.py`
      let sourcesManifest: Awaited<ReturnType<typeof materializeDatasetSourcesStep>> | null = null

      console.log(`[Dataset ${datasetId}] ========================================`)
      console.log(`[Dataset ${datasetId}] Action: executeCommand`)
      console.log(`[Dataset ${datasetId}] Description: ${commandDescription}`)
      console.log(`[Dataset ${datasetId}] Script: ${normalizedScriptName}`)
      console.log(`[Dataset ${datasetId}] File: ${scriptFile}`)
      console.log(`[Dataset ${datasetId}] Code length: ${pythonCode.length} chars`)
      console.log(`[Dataset ${datasetId}] ========================================`)

      try {
        if (contextId && Array.isArray(sources) && sources.length > 0) {
          sourcesManifest = await materializeDatasetSourcesStep({
            runtime,
            sandboxId,
            contextId,
            sources,
            sourceKeys,
          })
          console.log(`[Dataset ${datasetId}] Sources manifest: ${sourcesManifest.manifestPath}`)
        }

        await runDatasetSandboxCommandStep({
          runtime,
          sandboxId,
          cmd: "mkdir",
          args: ["-p", ...getDatasetStandardDirs(datasetId), scriptsDir],
        })

        await writeDatasetSandboxTextFilesStep({
          runtime,
          sandboxId,
          files: [{ path: scriptFile, content: pythonCode }],
        })

        const written = await runDatasetSandboxCommandStep({
          runtime,
          sandboxId,
          cmd: "test",
          args: ["-f", scriptFile],
        })

        if (written.exitCode !== 0) {
          const error = `Script write verification failed: ${scriptFile}`
          console.error(`[Dataset ${datasetId}] ${error}`)
          console.error(`[Dataset ${datasetId}] ========================================`)

          return {
            success: false,
            fatal: true,
            status: "script_write_failed",
            error,
            stdout: written.stdout || "",
            stderr: written.stderr || "",
            exitCode: written.exitCode,
            scriptPath: scriptFile,
            sourcesDir: sourcesManifest?.sourcesDir,
            sourcesManifestPath: sourcesManifest?.manifestPath,
            materializedSources: sourcesManifest?.sources,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutOriginalLength: 0,
            stderrOriginalLength: 0,
          }
        }

        const pythonArgs = sourcesManifest
          ? [
              "-c",
              [
                "import os, runpy",
                `os.environ["EKAIROS_DATASET_SOURCES_DIR"] = ${JSON.stringify(sourcesManifest.sourcesDir)}`,
                `os.environ["EKAIROS_DATASET_SOURCES_MANIFEST"] = ${JSON.stringify(sourcesManifest.manifestPath)}`,
                `runpy.run_path(${JSON.stringify(scriptFile)}, run_name="__main__")`,
              ].join("; "),
            ]
          : [scriptFile]

        console.log(`[Dataset ${datasetId}] Script written to: ${scriptFile}`)
        console.log(
          `[Dataset ${datasetId}] Executing: python ${sourcesManifest ? "<with dataset sources env>" : scriptFile}`,
        )

        const result = await runDatasetSandboxCommandStep({
          runtime,
          sandboxId,
          cmd: "python",
          args: pythonArgs,
        })

        const stdout = result.stdout || ""
        const stderr = result.stderr || ""
        const exitCode = result.exitCode
        const isStdoutTruncated = stdout.length > MAX_STDOUT_CHARS
        const isStderrTruncated = stderr.length > MAX_STDERR_CHARS
        const stdoutCapped = isStdoutTruncated ? stdout.slice(0, MAX_STDOUT_CHARS) : stdout
        const stderrCapped = isStderrTruncated ? stderr.slice(0, MAX_STDERR_CHARS) : stderr

        if (exitCode !== 0) {
          console.error(`[Dataset ${datasetId}] Command failed with exit code ${exitCode}`)
          console.error(`[Dataset ${datasetId}] Stderr:`, stderrCapped.substring(0, 500))
          console.error(`[Dataset ${datasetId}] ========================================`)

          return {
            success: false,
            exitCode,
            stdout: stdoutCapped,
            stderr: stderrCapped,
            scriptPath: scriptFile,
            error: `Command failed with exit code ${exitCode}`,
            sourcesDir: sourcesManifest?.sourcesDir,
            sourcesManifestPath: sourcesManifest?.manifestPath,
            materializedSources: sourcesManifest?.sources,
            stdoutTruncated: isStdoutTruncated,
            stderrTruncated: isStderrTruncated,
            stdoutOriginalLength: stdout.length,
            stderrOriginalLength: stderr.length,
          }
        }

        if (stderr && (stderr.includes("Traceback") || stderr.toLowerCase().includes("error"))) {
          console.error(`[Dataset ${datasetId}] Python error detected`)
          console.error(`[Dataset ${datasetId}] Stderr:`, stderrCapped.substring(0, 500))
          console.error(`[Dataset ${datasetId}] ========================================`)

          return {
            success: false,
            exitCode,
            stdout: stdoutCapped,
            stderr: stderrCapped,
            scriptPath: scriptFile,
            error: "Python error detected in stderr",
            sourcesDir: sourcesManifest?.sourcesDir,
            sourcesManifestPath: sourcesManifest?.manifestPath,
            materializedSources: sourcesManifest?.sources,
            stdoutTruncated: isStdoutTruncated,
            stderrTruncated: isStderrTruncated,
            stdoutOriginalLength: stdout.length,
            stderrOriginalLength: stderr.length,
          }
        }

        console.log(`[Dataset ${datasetId}] Command executed successfully`)
        if (stdout) {
          console.log(`[Dataset ${datasetId}] Output length: ${stdout.length} chars`)
          if (isStdoutTruncated) {
            console.log(`[Dataset ${datasetId}] Stdout truncated to ${MAX_STDOUT_CHARS} chars`)
          }
        }
        console.log(`[Dataset ${datasetId}] ========================================`)

        return {
          success: true,
          exitCode,
          stdout: stdoutCapped,
          stderr: stderrCapped,
          scriptPath: scriptFile,
          message: "Command executed successfully",
          sourcesDir: sourcesManifest?.sourcesDir,
          sourcesManifestPath: sourcesManifest?.manifestPath,
          materializedSources: sourcesManifest?.sources,
          stdoutTruncated: isStdoutTruncated,
          stderrTruncated: isStderrTruncated,
          stdoutOriginalLength: stdout.length,
          stderrOriginalLength: stderr.length,
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        console.error(`[Dataset ${datasetId}] executeCommand failed:`, errorMessage)
        console.error(`[Dataset ${datasetId}] ========================================`)

        return {
          success: false,
          error: errorMessage,
          stdout: "",
          stderr: "",
          exitCode: -1,
          scriptPath: scriptFile,
          sourcesDir: sourcesManifest?.sourcesDir,
          sourcesManifestPath: sourcesManifest?.manifestPath,
          materializedSources: sourcesManifest?.sources,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutOriginalLength: 0,
          stderrOriginalLength: 0,
        }
      }
    },
  })

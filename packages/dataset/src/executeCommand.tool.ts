import { defineAction } from "@ekairos/events"
import { z } from "zod"

import { materializeContextResourcesStep } from "./contextResources.js"
import { getDatasetScriptsDir, getDatasetStandardDirs } from "./datasetFiles.js"
import { getContextExecutionWorkspaceDirs } from "./contextWorkspace.js"
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

interface ExecuteCommandToolParams {
  datasetId: string
  sandboxId: string
  runtime: any
}

const executeCommandInputSchema = z.object({
  commandDescription: z
    .string()
    .min(1)
    .describe(
      "Required pre-execution description of the command. Describe the inputs/resources it will use, the operation it will perform, the expected output, and why a command is the right tool instead of direct completion. Invalid descriptions include rereading resources whose descriptor/preview already contains the needed evidence, merely formatting JSON, constructing the final object, writing output.jsonl, or making completion easier.",
    ),
  pythonCode: z
    .string()
    .describe(
      "Python code to execute. Saved to a file before running. MANDATORY: Use print() to report progress and final results. Keep prints concise; avoid dumping rows/JSON. If context resources are materialized, read os.environ['EKAIROS_CONTEXT_RESOURCES_MANIFEST'] to discover files and metadata. Do not install packages, download dependencies, use pip/npm/apt/curl/wget, or access the network. For large outputs, write to files in the workstation directory and print only file paths and brief summaries.",
    ),
  scriptName: z
    .string()
    .describe(
      "Name for the script file in snake_case (e.g., 'inspect_file', 'parse_csv', 'generate_dataset'). A deterministic suffix will be appended automatically.",
    ),
  resourceKeys: z
    .array(z.string())
    .optional()
    .describe("Optional context resource keys to materialize before running the script. Omit to materialize every context resource."),
})

const materializedResourceSchema = z.object({
  key: z.string(),
  type: z.string(),
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

const executeCommandOutputSchema = z
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
    resourcesDir: z.string().optional(),
    resourcesManifestPath: z.string().optional(),
    materializedResources: z.array(materializedResourceSchema).optional(),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
    stdoutOriginalLength: z.number(),
    stderrOriginalLength: z.number(),
  })
  .passthrough()

export function createExecuteCommandTool({ datasetId, sandboxId, runtime }: ExecuteCommandToolParams): any {
  return defineAction({
    description:
      "Execute Python scripts in the sandbox only when command execution is necessary to inspect, parse, aggregate, join, or compute over context resources that are not sufficiently represented in the visible context, resource descriptors, or previews. This is a high-cost computation tool, not a completion tool. Do not use it merely to reread resources whose descriptor/preview already contains the needed evidence, format JSON, build the final object, write output.jsonl, or make completion easier when completeObject or replaceRows can return the result directly. Before the script runs, requested context resources are materialized into /tmp/ekairos/contexts/{contextId}/resources and a manifest.json is written there. The Python process receives EKAIROS_CONTEXT_RESOURCES_DIR and EKAIROS_CONTEXT_RESOURCES_MANIFEST environment variables when resources are available; manifest entries expose files as resources[].files[].path. Do not install packages, download dependencies, use pip/npm/apt/curl/wget, or access the network; use only the available runtime and standard library unless a dependency is already present. Print concise progress and results only; do not dump large data.",
    input: executeCommandInputSchema,
    output: executeCommandOutputSchema,
    execute: async ({
      input,
      context,
      contextId,
      executionId,
    }: any) => {
      const { commandDescription, pythonCode, resourceKeys, scriptName } = input
      const normalizedScriptName = normalizeScriptName(scriptName)
      const scriptHash = stableScriptHash(`${normalizedScriptName}\0${pythonCode}`)
      const scriptsDir =
        contextId && executionId
          ? getContextExecutionWorkspaceDirs({ contextId, executionId }).scriptsDir
          : getDatasetScriptsDir(datasetId)
      const scriptFile = `${scriptsDir}/${normalizedScriptName}-${scriptHash}.py`
      let resourcesManifest: Awaited<ReturnType<typeof materializeContextResourcesStep>> | null = null

      console.log(`[Dataset ${datasetId}] ========================================`)
      console.log(`[Dataset ${datasetId}] Action: executeCommand`)
      console.log(`[Dataset ${datasetId}] Description: ${commandDescription}`)
      console.log(`[Dataset ${datasetId}] Script: ${normalizedScriptName}`)
      console.log(`[Dataset ${datasetId}] File: ${scriptFile}`)
      console.log(`[Dataset ${datasetId}] Code length: ${pythonCode.length} chars`)
      console.log(`[Dataset ${datasetId}] ========================================`)

      try {
        if (contextId && Array.isArray(context?.resources) && context.resources.length > 0) {
          resourcesManifest = await materializeContextResourcesStep({
            runtime,
            sandboxId,
            contextId,
            resources: context.resources,
            resourceKeys,
          })
          console.log(`[Dataset ${datasetId}] Resources manifest: ${resourcesManifest.manifestPath}`)
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
            resourcesDir: resourcesManifest?.resourcesDir,
            resourcesManifestPath: resourcesManifest?.manifestPath,
            materializedResources: resourcesManifest?.resources,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutOriginalLength: 0,
            stderrOriginalLength: 0,
          }
        }

        const pythonArgs = resourcesManifest
          ? [
              "-c",
              [
                "import os, runpy",
                `os.environ["EKAIROS_CONTEXT_RESOURCES_DIR"] = ${JSON.stringify(resourcesManifest.resourcesDir)}`,
                `os.environ["EKAIROS_CONTEXT_RESOURCES_MANIFEST"] = ${JSON.stringify(resourcesManifest.manifestPath)}`,
                `runpy.run_path(${JSON.stringify(scriptFile)}, run_name="__main__")`,
              ].join("; "),
            ]
          : [scriptFile]

        console.log(`[Dataset ${datasetId}] Script written to: ${scriptFile}`)
        console.log(
          `[Dataset ${datasetId}] Executing: python ${resourcesManifest ? "<with context resources env>" : scriptFile}`,
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
            resourcesDir: resourcesManifest?.resourcesDir,
            resourcesManifestPath: resourcesManifest?.manifestPath,
            materializedResources: resourcesManifest?.resources,
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
            resourcesDir: resourcesManifest?.resourcesDir,
            resourcesManifestPath: resourcesManifest?.manifestPath,
            materializedResources: resourcesManifest?.resources,
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
          resourcesDir: resourcesManifest?.resourcesDir,
          resourcesManifestPath: resourcesManifest?.manifestPath,
          materializedResources: resourcesManifest?.resources,
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
          resourcesDir: resourcesManifest?.resourcesDir,
          resourcesManifestPath: resourcesManifest?.manifestPath,
          materializedResources: resourcesManifest?.resources,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutOriginalLength: 0,
          stderrOriginalLength: 0,
        }
      }
    },
  })
}

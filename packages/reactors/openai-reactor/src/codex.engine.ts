import type {
  ReactorActionMap,
  ReactorEngine,
  ReactorEngineStepInput,
} from "@ekairos/reactor"
import {
  installCodexAuthToSandboxSession,
  type CodexSandboxAuthSource,
  type SandboxSession,
} from "@ekairos/sandbox"

import {
  codexSandboxBridgeScript,
  codexSandboxTurnRunnerScript,
  type CodexTurnResult,
} from "./codex.reactor.js"

export type CodexEngineAuthConfig =
  | ({
      source: "local"
    } & CodexSandboxAuthSource)
  | {
      source: "preinstalled"
      codexHome?: string
    }

export type CodexEngineConfig = {
  model?: string
  repoPath?: string
  codexHome?: string
  bridgePort?: number
  installCodexCli?: boolean
  auth?: CodexEngineAuthConfig
}

type CodexEnginePrepared = {
  codexHome: string
  repoPath: string
  bridgePort: number
  workRoot: string
  bridgePath: string
  turnRunnerPath: string
}

function isPosixPath(value: string) {
  return value.startsWith("/")
}

function joinSandboxPath(root: string, ...segments: string[]) {
  const normalizedRoot = root.replace(/[\\/]+$/, "")
  const separator = isPosixPath(normalizedRoot) ? "/" : "\\"
  return [normalizedRoot, ...segments].join(separator)
}

function shQuote(value: string) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function requireSandbox(
  sandbox: ReactorEngineStepInput<unknown, unknown, unknown, ReactorActionMap>["sandbox"],
): SandboxSession {
  if (!sandbox) {
    throw new Error("codex_engine_sandbox_required")
  }
  if (typeof sandbox.exec !== "function") {
    throw new Error("codex_engine_sandbox_exec_required")
  }
  return sandbox as SandboxSession
}

async function runShell(
  sandbox: SandboxSession,
  script: string,
  label: string,
  requiredText?: string,
) {
  const result = await sandbox.exec({
    command: "sh",
    args: ["-lc", script],
    cwd: sandbox.workspaceRoot,
    timeoutMs: 240000,
  })
  if (!result.success) {
    throw new Error(`${label}: ${result.error || result.output || `exit_${result.exitCode}`}`)
  }
  if (requiredText && !`${result.output}\n${result.error}`.includes(requiredText)) {
    throw new Error(`${label}: missing_sentinel:${requiredText}`)
  }
  return result
}

async function prepareCodexInSandbox(
  sandbox: SandboxSession,
  config: CodexEngineConfig,
): Promise<CodexEnginePrepared> {
  const bridgePort = Math.max(1, Number(config.bridgePort ?? 4500))
  const codexHome =
    config.auth?.source === "preinstalled" && config.auth.codexHome
      ? config.auth.codexHome
      : config.codexHome ?? joinSandboxPath(sandbox.workspaceRoot, ".codex")
  const repoPath = config.repoPath ?? sandbox.workspaceRoot
  const workRoot = joinSandboxPath(sandbox.workspaceRoot, ".ekairos", "codex")
  const bridgePath = joinSandboxPath(workRoot, "codex-bridge.mjs")
  const turnRunnerPath = joinSandboxPath(workRoot, "codex-turn-runner.mjs")

  if (config.auth?.source === "local") {
    await installCodexAuthToSandboxSession(sandbox, {
      codexHome,
      authJsonPath: config.auth.authJsonPath,
      credentialsJsonPath: config.auth.credentialsJsonPath,
      configTomlPath: config.auth.configTomlPath,
    })
  }

  await sandbox.writeFiles([
    {
      path: bridgePath,
      content: codexSandboxBridgeScript(),
    },
    {
      path: turnRunnerPath,
      content: codexSandboxTurnRunnerScript(),
    },
  ])

  await runShell(
    sandbox,
    [
      "set -euo pipefail",
      `mkdir -p ${shQuote(codexHome)} ${shQuote(workRoot)} ${shQuote(repoPath)}`,
      `chmod 700 ${shQuote(codexHome)} || true`,
      `chmod 600 ${shQuote(joinSandboxPath(codexHome, "auth.json"))} 2>/dev/null || true`,
      config.installCodexCli === false
        ? "command -v codex >/dev/null 2>&1"
        : "if ! command -v codex >/dev/null 2>&1; then npm i -g @openai/codex@latest; fi",
      `HOME=${shQuote(sandbox.workspaceRoot)} CODEX_HOME=${shQuote(codexHome)} codex login status`,
      "echo codex_engine_prepare_ok",
    ].join("\n"),
    "codex_engine_prepare",
    "codex_engine_prepare_ok",
  )

  await runShell(
    sandbox,
    [
      "set -euo pipefail",
      `if ! curl -fsS http://127.0.0.1:${bridgePort}/health >/dev/null 2>&1; then`,
      `  HOME=${shQuote(sandbox.workspaceRoot)} CODEX_HOME=${shQuote(codexHome)} CODEX_BRIDGE_PORT=${bridgePort} nohup node ${shQuote(bridgePath)} > /tmp/ekairos-codex-bridge-${bridgePort}.log 2>&1 &`,
      `  echo $! > /tmp/ekairos-codex-bridge-${bridgePort}.pid`,
      "fi",
      `for i in $(seq 1 90); do curl -fsS http://127.0.0.1:${bridgePort}/health >/dev/null 2>&1 && echo codex_engine_bridge_ok && exit 0; sleep 1; done`,
      `cat /tmp/ekairos-codex-bridge-${bridgePort}.log || true`,
      "exit 1",
    ].join("\n"),
    "codex_engine_start_bridge",
    "codex_engine_bridge_ok",
  )

  return {
    codexHome,
    repoPath,
    bridgePort,
    workRoot,
    bridgePath,
    turnRunnerPath,
  }
}

function parseCodexResult(output: string): CodexTurnResult {
  const line = output
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("EKAIROS_CODEX_RESULT\t"))
  if (!line) {
    throw new Error("codex_engine_result_missing")
  }
  return JSON.parse(line.slice("EKAIROS_CODEX_RESULT\t".length)) as CodexTurnResult
}

function parseStructuredOutput(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced?.[1]) return JSON.parse(fenced[1].trim())
    throw new Error("codex_engine_output_json_required")
  }
}

export function codexEngine<TContext = unknown, TEnv = unknown>(
  config: CodexEngineConfig = {},
): ReactorEngine<TContext, TEnv> {
  return {
    async step<TOutput, TActions extends ReactorActionMap>(
      input: ReactorEngineStepInput<TContext, TEnv, TOutput, TActions>,
    ) {
      const sandbox = requireSandbox(input.sandbox)
      const prepared = await prepareCodexInSandbox(sandbox, config)
      const instructionPath = joinSandboxPath(
        prepared.workRoot,
        `instruction-${input.executionId}-${input.step.key}.txt`,
      )
      const instruction = [
        input.step.instructions,
        input.step.payload === undefined
          ? ""
          : `\nPayload:\n${JSON.stringify(input.step.payload, null, 2)}`,
        input.step.output
          ? "\nReturn only valid JSON matching the requested result shape."
          : "",
      ].join("\n")

      await sandbox.writeFile({
        path: instructionPath,
        content: instruction,
      })

      const result = await runShell(
        sandbox,
        [
          "set -euo pipefail",
          `HOME=${shQuote(sandbox.workspaceRoot)} CODEX_HOME=${shQuote(prepared.codexHome)} CODEX_BRIDGE_URL=http://127.0.0.1:${prepared.bridgePort} CODEX_INSTRUCTION_FILE=${shQuote(instructionPath)} CODEX_REPO_PATH=${shQuote(prepared.repoPath)} CODEX_MODEL=${shQuote(config.model ?? "")} node ${shQuote(prepared.turnRunnerPath)}`,
        ].join("\n"),
        "codex_engine_turn",
      )
      const turn = parseCodexResult(result.output ?? "")
      if (!input.step.output) return turn.assistantText
      return parseStructuredOutput(turn.assistantText)
    },
  }
}

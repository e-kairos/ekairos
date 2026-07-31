import type {
  ReactionEngine,
  ReactionEngineActions,
  ReactionEngineInput,
} from "@ekairos/reactor"
import type { ContextPartEnvelope } from "@ekairos/events"
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde"
import {
  installCodexAuthToSandboxSession,
  type CodexSandboxAuthSource,
  type SandboxSession,
} from "@ekairos/sandbox"

import {
  buildCodexDynamicTools,
  buildCodexInstruction,
  codexActionResponse,
  codexSandboxBridgeScript,
  codexSandboxTurnRunnerScript,
  executeCodexAction,
  resolveCodexCanonicalActionName,
  type CodexTurnResult,
} from "./codex.runtime.js"
import {
  prepareLocalCodex,
  type LocalCodexPrepared,
} from "./codex.local.js"

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
  codexPath?: string
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
  sandbox: ReactionEngineInput<unknown, unknown, ReactionEngineActions>["sandbox"],
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
  const result = JSON.parse(line.slice("EKAIROS_CODEX_RESULT\t".length)) as CodexTurnResult
  if (result.status !== "completed" && result.status !== "action_required") {
    throw new Error("codex_engine_result_status_invalid")
  }
  const completedTurn = asRecord((result as Record<string, unknown>).completedTurn)
  const status = asString(completedTurn.status).trim().toLowerCase()
  const error = asRecord(completedTurn.error)
  if (status === "failed" || Object.keys(error).length > 0) {
    throw new Error(
      asString(error.message) ||
        asString(error.error) ||
        `codex_turn_failed_${asString(result.turnId) || "unknown"}`,
    )
  }
  return result
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

export class CodexEngine<TContext = unknown>
  implements ReactionEngine<TContext> {
  readonly config: Readonly<CodexEngineConfig>
  private readonly sandboxPreparations = new WeakMap<
    SandboxSession,
    Promise<CodexEnginePrepared>
  >()

  constructor(config: CodexEngineConfig = {}) {
    this.config = Object.freeze({ ...config })
  }

  static [WORKFLOW_SERIALIZE](instance: CodexEngine) {
    return { config: instance.config }
  }

  static [WORKFLOW_DESERIALIZE](data: { config: CodexEngineConfig }) {
    return new CodexEngine(data.config)
  }

  async agent<TOutput, TActions extends ReactionEngineActions>(
    input: ReactionEngineInput<TContext, TOutput, TActions>,
  ) {
    if (!input.sandbox) return await this.runLocalAgent(input)
    return await this.runSandboxAgent(input, requireSandbox(input.sandbox))
  }

  private async runLocalAgent<
    TOutput,
    TActions extends ReactionEngineActions,
  >(
    input: ReactionEngineInput<TContext, TOutput, TActions>,
  ) {
    const prepared: LocalCodexPrepared = await prepareLocalCodex({
      codexPath: this.config.codexPath,
      codexHome:
        this.config.auth?.source === "preinstalled"
          ? this.config.auth.codexHome ?? this.config.codexHome
          : this.config.codexHome,
      repoPath: this.config.repoPath ?? input.workspaceRoot,
    })
    const instruction = buildCodexInstruction(input)
    const dynamicTools = buildCodexDynamicTools(input.actions)
    return await runCodexAgent(input, async (state, actionResponse) =>
      await prepared.server.runTurn({
        instruction,
        dynamicTools,
        repoPath: prepared.repoPath,
        model: this.config.model,
        state,
        actionResponse,
      }))
  }

  private async runSandboxAgent<
    TOutput,
    TActions extends ReactionEngineActions,
  >(
    input: ReactionEngineInput<TContext, TOutput, TActions>,
    sandbox: SandboxSession,
  ) {
    const prepared = await this.prepareSandbox(sandbox)
    const instructionPath = joinSandboxPath(
      prepared.workRoot,
      `instruction-${input.sessionId}-${input.reactionId}.txt`,
    )
    const toolsPath = joinSandboxPath(
      prepared.workRoot,
      `tools-${input.sessionId}-${input.reactionId}.json`,
    )

    await sandbox.writeFiles([
      {
        path: instructionPath,
        content: buildCodexInstruction(input),
      },
      {
        path: toolsPath,
        content: JSON.stringify(buildCodexDynamicTools(input.actions)),
      },
    ])

    return await runCodexAgent(input, async (state, actionResponse, actionCall) => {
      const statePath = state
        ? joinSandboxPath(
            prepared.workRoot,
            `state-${input.sessionId}-${input.reactionId}-${actionCall}.json`,
          )
        : ""
      const responsePath = actionResponse
        ? joinSandboxPath(
            prepared.workRoot,
            `action-${input.sessionId}-${input.reactionId}-${actionCall}.json`,
          )
        : ""
      if (state && actionResponse) {
        await sandbox.writeFiles([
          { path: statePath, content: JSON.stringify(state) },
          { path: responsePath, content: JSON.stringify(actionResponse) },
        ])
      }
      const environment = [
        `HOME=${shQuote(sandbox.workspaceRoot)}`,
        `CODEX_HOME=${shQuote(prepared.codexHome)}`,
        `CODEX_BRIDGE_URL=http://127.0.0.1:${prepared.bridgePort}`,
        `CODEX_INSTRUCTION_FILE=${shQuote(instructionPath)}`,
        `CODEX_TOOLS_FILE=${shQuote(toolsPath)}`,
        `CODEX_REPO_PATH=${shQuote(prepared.repoPath)}`,
        `CODEX_MODEL=${shQuote(this.config.model ?? "")}`,
        statePath ? `CODEX_STATE_FILE=${shQuote(statePath)}` : "",
        responsePath ? `CODEX_ACTION_RESPONSE_FILE=${shQuote(responsePath)}` : "",
      ].filter(Boolean)
      const result = await runShell(
        sandbox,
        [
          "set -euo pipefail",
          `${environment.join(" ")} node ${shQuote(prepared.turnRunnerPath)}`,
        ].join("\n"),
        "codex_engine_turn",
      )
      return parseCodexResult(result.output ?? "")
    })
  }

  private async prepareSandbox(sandbox: SandboxSession) {
    const existing = this.sandboxPreparations.get(sandbox)
    if (existing) return await existing

    const preparation = prepareCodexInSandbox(sandbox, this.config).catch(error => {
      if (this.sandboxPreparations.get(sandbox) === preparation) {
        this.sandboxPreparations.delete(sandbox)
      }
      throw error
    })
    this.sandboxPreparations.set(sandbox, preparation)
    return await preparation
  }
}

type NextCodexTurn = (
  state: CodexTurnResult | undefined,
  actionResponse: Record<string, unknown> | undefined,
  actionCall: number,
) => Promise<CodexTurnResult>

async function runCodexAgent<
  TContext,
  TOutput,
  TActions extends ReactionEngineActions,
>(
  input: ReactionEngineInput<TContext, TOutput, TActions>,
  nextTurn: NextCodexTurn,
) {
  const maxActionCalls = Math.max(1, input.maxRounds ?? 32)
  const parts: ContextPartEnvelope[] = []
  let state: CodexTurnResult | undefined
  let actionResponse: Record<string, unknown> | undefined
  let turn: CodexTurnResult | undefined

  for (let actionCall = 0; actionCall <= maxActionCalls; actionCall += 1) {
    turn = await nextTurn(state, actionResponse, actionCall)
    if (turn.status === "completed") break
    if (!turn.action) throw new Error("codex_engine_action_request_missing")
    if (actionCall === maxActionCalls) {
      throw new Error(`codex_engine_max_action_calls:${maxActionCalls}`)
    }

    turn = {
      ...turn,
      action: {
        ...turn.action,
        name: resolveCodexCanonicalActionName(input.actions, turn.action.name),
      },
    }
    const action = turn.action!
    parts.push({
      type: "action",
      content: {
        status: "started",
        actionName: action.name,
        actionCallId: action.callId,
        input: action.input,
      },
    })
    const actionResult = await executeCodexAction(input.actions, action, {
      runtime: input.runtime,
      context: input.context,
      trigger: input.trigger,
      sessionId: input.sessionId,
      reactionId: input.reactionId,
      reactionKey: input.reactionKey,
      actionCallId: action.callId,
    })
    parts.push({
      type: "action",
      content: actionResult.success
        ? {
            status: "completed",
            actionName: action.name,
            actionCallId: action.callId,
            output: actionResult.output,
          }
        : {
            status: "failed",
            actionName: action.name,
            actionCallId: action.callId,
            error: { message: actionResult.errorText ?? "unknown_error" },
          },
    })
    state = turn
    actionResponse = codexActionResponse(action, actionResult)
  }

  if (!turn || turn.status !== "completed") {
    throw new Error("codex_engine_turn_incomplete")
  }
  return {
    output: input.output
      ? parseStructuredOutput(turn.assistantText)
      : turn.assistantText as TOutput,
    parts,
    metadata: {
      provider: "codex",
      providerContextId: turn.providerContextId,
      turnId: turn.turnId,
      usage: turn.usage,
      reasoning: turn.reasoningText,
      diff: turn.diff,
    }
  }
}

export function codexEngine<TContext = unknown>(
  config: CodexEngineConfig = {},
): CodexEngine<TContext> {
  return new CodexEngine(config)
}

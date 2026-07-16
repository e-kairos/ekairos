import {
  getDomainActions,
  type DomainActionRegistration,
} from "@ekairos/domain"
import {
  executeDomainAction,
  getDomainActionBinding,
  prepareDomainActionExecution,
} from "@ekairos/domain/internal"
import {
  Events,
  Part,
  getContextRuntimeServices,
  type ContextEvent,
  type ContextPartEnvelope,
  type ContextRuntimeServiceHandle,
  type DomainEventDraftLike,
} from "@ekairos/events"
import { Sandbox } from "@ekairos/sandbox/sandbox"
import { z } from "zod"

import { runReactionEngineAgent } from "./agent.js"
import { buildAgentModelMessages } from "./reaction-view.js"
import type {
  AnyReactionEngine,
  ReactionModel,
  ReactionToolAction,
  ReactorGitCloneOutput,
  ReactorGitCommitOutput,
  ReactorGitPushOutput,
  ReactorInitialContext,
  ReactorShellRunInput,
  ReactorShellRunOutput,
  ReactorWorkspaceInput,
  ReactorWorkspaceOutput,
} from "./reactor.js"
import type {
  DatasetAdapterHandle,
  DatasetAdapterProvider,
  DatasetAdapterSource,
} from "./dataset-adapter.js"

type AnyDomainAction = DomainActionRegistration<any, any, any, any>

export type ReactionOperationActionRef = Readonly<{
  id: string
  boundInput: Readonly<Record<string, unknown>>
}>

export type ReactionGitInput =
  | Readonly<{
      operation: "clone"
      target: string
      url: string
      ref?: string
      depth?: number
    }>
  | Readonly<{
      operation: "commit"
      repository: string
      message: string
      all?: boolean
      authorName?: string
      authorEmail?: string
    }>
  | Readonly<{
      operation: "push"
      repository: string
      remote?: string
      ref: string
      forceWithLease?: boolean
      setUpstream?: boolean
    }>

export type ReactionOperation =
  | Readonly<{
      kind: "agent"
      instruction: string
      outputSchema?: unknown
      actions: readonly ReactionOperationActionRef[]
      model?: ReactionModel
      maxRounds?: number
    }>
  | Readonly<{
      kind: "action"
      action: ReactionOperationActionRef
      input: unknown
    }>
  | Readonly<{
      kind: "dataset"
      instruction: string
      recordSchema: unknown
      source: DatasetAdapterSource
    }>
  | Readonly<{ kind: "workspace"; input: ReactorWorkspaceInput }>
  | Readonly<{ kind: "shell"; input: ReactorShellRunInput }>
  | Readonly<{ kind: "git"; input: ReactionGitInput }>
  | Readonly<{
      kind: "emit"
      draft: DomainEventDraftLike
      channel?: string
    }>

export type ReactionOperationRequest = Readonly<{
  runtime: ContextRuntimeServiceHandle & {
    use(domain: unknown, options?: unknown): Promise<unknown>
    env?: unknown
    materializeDataset?: DatasetAdapterProvider
  }
  context: ReactorInitialContext<unknown>
  trigger: ContextEvent
  definition: string
  sessionId: string
  rootReactionId: string
  reactionId: string
  eventId: string
  position: number
  causeIds: readonly string[]
  engine: AnyReactionEngine<unknown> | false
  sandboxId: string | false
  operation: ReactionOperation
}>

export type ReactionOperationResult = Readonly<{
  event: ContextEvent
}>

export function toReactionOperationActionRef(
  action: AnyDomainAction,
): ReactionOperationActionRef {
  const binding = getDomainActionBinding(action)
  if (!binding) throw new Error("reaction_action_registration_required")
  return Object.freeze({
    id: binding.id,
    boundInput: Object.freeze({ ...binding.boundInput }),
  })
}

export async function executeReactionOperation(
  request: ReactionOperationRequest,
): Promise<ReactionOperationResult> {
  "use step"

  const { store } = await getContextRuntimeServices(request.runtime)
  const existingReaction = await store.getReaction(request.reactionId)
  if (existingReaction?.status === "completed") {
    const effectId = existingReaction.effectIds[0]
    const event = effectId ? await store.getEvent(effectId) : null
    if (!event) throw new Error(`reaction_operation_effect_not_found:${request.reactionId}`)
    return Object.freeze({ event })
  }
  if (existingReaction?.status === "failed") {
    throw new Error(`reaction_operation_already_failed:${request.reactionId}`)
  }

  await store.openReaction({
    id: request.reactionId,
    sessionId: request.sessionId,
    type: operationType(request.operation),
    position: request.position,
    depth: 1,
    causeIds: request.causeIds,
    parentReactionId: request.rootReactionId,
    ...(operationInstruction(request.operation)
      ? { instruction: operationInstruction(request.operation) }
      : {}),
  })

  try {
    const event = await runOperation(request)
    await store.completeReaction(request.reactionId, "completed", [event.id])
    return Object.freeze({ event })
  } catch (error) {
    await store.completeReaction(request.reactionId, "failed", [], error).catch(() => undefined)
    throw error
  }
}

async function runOperation(request: ReactionOperationRequest): Promise<ContextEvent> {
  const operation = request.operation
  if (operation.kind === "emit") {
    return await Events(request.runtime).emit(operation.draft, {
      id: request.eventId,
      ...(operation.channel ?? request.trigger.channel
        ? { channel: operation.channel ?? request.trigger.channel }
        : {}),
      contextId: request.context.ref.id,
      metadata: operationMetadata(request),
    })
  }

  if (operation.kind === "agent") {
    if (request.engine === false) throw new Error("reaction_engine_not_configured")
    const output = operation.outputSchema
      ? schemaFromJson(operation.outputSchema, "reaction_agent_output")
      : undefined
    const actions = resolveEngineActions(request.runtime, operation.actions)
    const sandbox = await openSandbox(request)
    const messages = await buildAgentModelMessages({
      runtime: request.runtime,
      reactionKey: request.definition,
      instruction: operation.instruction,
      context: request.context,
      events: await hydrateEvents(request.runtime, request.causeIds),
    })
    const result = await runReactionEngineAgent({
      engine: request.engine,
      request: {
        reactionKey: request.definition,
        runtime: request.runtime,
        context: request.context,
        trigger: request.trigger,
        sessionId: request.sessionId,
        reactionId: request.reactionId,
        given: await hydrateEvents(request.runtime, request.causeIds),
        messages,
        instruction: operation.instruction,
        ...(output ? { output } : {}),
        ...(operation.model ? { model: operation.model } : {}),
        ...(operation.maxRounds === undefined ? {} : { maxRounds: operation.maxRounds }),
        actions,
        ...(sandbox ? { sandbox, workspaceRoot: sandbox.workspaceRoot } : {}),
      },
    })
    return await createOperationEvent(request, result.output, result.parts ?? [], {
      ...(result.metadata ?? {}),
      instruction: operation.instruction,
    })
  }

  if (operation.kind === "action") {
    const action = resolveAction(request.runtime, operation.action)
    const prepared = await prepareDomainActionExecution(
      request.runtime as any,
      action,
      operation.input as any,
    )
    const callId = request.reactionId
    const started: ContextPartEnvelope = {
      type: "action",
      content: {
        status: "started",
        actionName: operation.action.id,
        actionCallId: callId,
        input: prepared.effectiveInput,
      },
    }
    try {
      const executed = await executeDomainAction(
        request.runtime as any,
        action,
        prepared,
      )
      const parsed = action.output.parse(executed.output)
      return await createOperationEvent(request, parsed, [
        started,
        {
          type: "action",
          content: {
            status: "completed",
            actionName: operation.action.id,
            actionCallId: callId,
            output: parsed,
          },
        },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await createOperationEvent(request, { error: message }, [
        started,
        {
          type: "action",
          content: {
            status: "failed",
            actionName: operation.action.id,
            actionCallId: callId,
            error: { message },
          },
        },
      ], { failed: true })
      throw error
    }
  }

  if (operation.kind === "dataset") {
    const provider = request.runtime.materializeDataset
    if (typeof provider !== "function") {
      throw new Error("reaction_dataset_provider_not_configured")
    }
    const result: any = await provider({
      runtime: request.runtime,
      ...(request.sandboxId === false ? {} : { sandboxId: request.sandboxId }),
      sessionId: request.sessionId,
      reactionId: request.reactionId,
      contextId: request.context.ref.id,
      context: request.context,
      trigger: request.trigger,
      ...(request.engine === false ? {} : { engine: request.engine }),
      spec: {
        datasetId: request.eventId,
        ensure: {
          source: operation.source,
          instructions: operation.instruction,
          schema: { schema: operation.recordSchema },
        },
      },
    })
    const schema = schemaFromJson(operation.recordSchema, "reaction_dataset_record")
    const preview = (result.previewRows ?? result.preview ?? []).map((row: unknown) => schema.parse(row))
    const handle: DatasetAdapterHandle = Object.freeze({
      datasetId: String(result.datasetId ?? request.eventId),
      mode: result.mode === "opened" ? "opened" : "built",
      preview: Object.freeze(preview),
      ...(typeof result.count === "number" ? { count: result.count } : {}),
    })
    return await createOperationEvent(request, handle, [Part.json(handle)], {
      instruction: operation.instruction,
    })
  }

  if (operation.kind === "workspace") {
    const result = await materializeWorkspace(request, operation.input)
    return await createOperationEvent(request, result, [Part.json(result)])
  }

  if (operation.kind === "shell") {
    const result = await runShell(request, operation.input)
    return await createOperationEvent(request, result, [Part.json(result)])
  }

  const result = await runGit(request, operation.input)
  return await createOperationEvent(request, result, [Part.json(result)])
}

async function createOperationEvent(
  request: ReactionOperationRequest,
  payload: unknown,
  parts: readonly ContextPartEnvelope[] = [],
  metadata: Readonly<Record<string, unknown>> = {},
) {
  return await Events(request.runtime).create({
    id: request.eventId,
    type: `context.${operationType(request.operation)}`,
    payload,
    contextId: request.context.ref.id,
    metadata: { ...operationMetadata(request), ...metadata },
    parts,
  })
}

function operationMetadata(request: ReactionOperationRequest) {
  return Object.freeze({
    sessionId: request.sessionId,
    reactionId: request.reactionId,
    definition: request.definition,
  })
}

function operationType(operation: ReactionOperation) {
  if (operation.kind === "git") return `git.${operation.input.operation}`
  return operation.kind
}

function operationInstruction(operation: ReactionOperation) {
  return "instruction" in operation ? operation.instruction : undefined
}

function schemaFromJson(value: unknown, label: string): z.ZodType {
  try {
    return z.fromJSONSchema(value as never) as z.ZodType
  } catch (error) {
    throw new Error(`${label}_schema_invalid:${error instanceof Error ? error.message : String(error)}`)
  }
}

function runtimeRootDomain(runtime: ReactionOperationRequest["runtime"]) {
  const root = typeof runtime.meta === "function" ? runtime.meta()?.domain : undefined
  if (!root) throw new Error("reaction_runtime_domain_required")
  return root
}

function resolveAction(
  runtime: ReactionOperationRequest["runtime"],
  ref: ReactionOperationActionRef,
): AnyDomainAction {
  const candidate = getDomainActions(runtimeRootDomain(runtime) as any)
    .find(action => getDomainActionBinding(action)?.id === ref.id)
  if (!candidate) throw new Error(`reaction_action_not_in_runtime:${ref.id}`)
  return Object.keys(ref.boundInput).length === 0
    ? candidate
    : (candidate as any).scope(ref.boundInput)
}

function resolveEngineActions(
  runtime: ReactionOperationRequest["runtime"],
  refs: readonly ReactionOperationActionRef[],
) {
  return Object.freeze(Object.fromEntries(refs.map(ref => {
    const action = resolveAction(runtime, ref)
    const binding = getDomainActionBinding(action)!
    const tool: ReactionToolAction = Object.freeze({
      description: action.description,
      input: action.input,
      output: action.output,
      async execute(input: unknown) {
        const prepared = await prepareDomainActionExecution(runtime as any, action, input as any)
        return (await executeDomainAction(runtime as any, action, prepared)).output
      },
    })
    return [binding.id, tool]
  })))
}

async function hydrateEvents(
  runtime: ContextRuntimeServiceHandle,
  ids: readonly string[],
) {
  const { store } = await getContextRuntimeServices(runtime)
  const events: ContextEvent[] = []
  for (const id of ids) {
    const event = await store.getEvent(id)
    if (!event) throw new Error(`reaction_given_event_not_found:${id}`)
    events.push(event)
  }
  return Object.freeze(events)
}

export function deriveDatasetSource(events: readonly ContextEvent[]): DatasetAdapterSource {
  const files = new Set<string>()
  for (const event of events) {
    for (const [alias, value] of Object.entries(event.links)) {
      if (event.physicalLinks[alias]?.target !== "$files") continue
      for (const id of Array.isArray(value) ? value : [value]) {
        if (typeof id === "string") files.add(id)
      }
    }
  }
  if (files.size > 0) {
    return Object.freeze({
      files: Object.freeze([...files].map(fileId => Object.freeze({ fileId }))),
    })
  }

  const datasets = new Set<string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== "object") return
    const datasetId = (value as any).datasetId
    if (typeof datasetId === "string" && datasetId) datasets.add(datasetId)
  }
  events.forEach(event => visit(event.payload))
  if (datasets.size > 0) {
    return Object.freeze({
      datasets: Object.freeze([...datasets].map(datasetId => Object.freeze({ datasetId }))),
    })
  }

  const rows = events.length === 1 && Array.isArray(events[0]!.payload)
    ? events[0]!.payload
    : events.map(event => event.payload)
  return Object.freeze({
    rows: Object.freeze([...rows]),
    name: "causal-events.jsonl",
    description: "Payloads selected explicitly through reaction.given(...).",
  })
}

async function openSandbox(request: ReactionOperationRequest) {
  if (request.sandboxId === false) return undefined
  return await Sandbox.open(request.runtime as any, request.sandboxId)
}

async function requireSandbox(request: ReactionOperationRequest) {
  const sandbox = await openSandbox(request)
  if (!sandbox) throw new Error("reaction_sandbox_not_configured")
  return sandbox
}

async function runShell(
  request: ReactionOperationRequest,
  input: ReactorShellRunInput,
): Promise<ReactorShellRunOutput> {
  if (!input.command?.trim()) throw new Error("reaction_shell_command_required")
  const sandbox = await requireSandbox(request)
  const cwd = resolveWorkspacePath(sandbox.workspaceRoot, input.cwd)
  const result: any = await sandbox.exec({
    command: input.command,
    args: [...(input.args ?? [])],
    cwd,
    env: input.env ? { ...input.env } : undefined,
    timeoutMs: input.timeoutMs,
  })
  const exitCode = typeof result.exitCode === "number" ? result.exitCode : result.success === false ? 1 : 0
  return Object.freeze({
    success: typeof result.success === "boolean" ? result.success : exitCode === 0,
    exitCode,
    output: typeof result.output === "string" ? result.output : "",
    error: typeof result.error === "string" ? result.error : "",
    command: [input.command, ...(input.args ?? [])].join(" "),
    ...(cwd ? { cwd } : {}),
  })
}

async function materializeWorkspace(
  request: ReactionOperationRequest,
  input: ReactorWorkspaceInput,
): Promise<ReactorWorkspaceOutput> {
  const sandbox = await requireSandbox(request)
  const refs = [...new Set(
    (Array.isArray(input.files) ? input.files : [input.files])
      .map(value => String(value).trim())
      .filter(Boolean),
  )]
  if (refs.length === 0) throw new Error("reaction_workspace_files_required")
  const directory = normalizeRelativePath(input.directory ?? "files")
  const root = sandbox.workspaceRoot
  const db = await request.runtime.db()
  const files: any[] = []

  for (const ref of refs) {
    const result = await db.query({ $files: { $: { where: { id: ref }, limit: 1 } } } as any)
    const file = result?.$files?.[0]
    if (!file) throw new Error(`reaction_workspace_file_not_found:${ref}`)
    const fileId = String(file.id)
    const filename = safeFilename(String(file.path ?? file.name ?? fileId))
    const path = joinPath(root, directory, filename)
    const bytes = await loadFileBytes(fileId, file.url)
    const exists = await sandbox.exists(path)
    let status: "created" | "reused" | "replaced" = "created"
    if (exists) {
      if (input.conflict === "error") {
        throw new Error(`reaction_workspace_file_conflict:${path}`)
      }
      const current = await sandbox.readFile(path)
      if (sameBytes(current, bytes)) {
        status = "reused"
      } else if (input.conflict === "replace") {
        await sandbox.writeFile({ path, content: bytes })
        status = "replaced"
      } else {
        throw new Error(`reaction_workspace_file_conflict:${path}`)
      }
    } else {
      await sandbox.writeFile({ path, content: bytes })
    }
    files.push(Object.freeze({
      ref,
      fileId,
      filename,
      ...(file["content-type"] ?? file.contentType
        ? { mediaType: String(file["content-type"] ?? file.contentType) }
        : {}),
      path,
      status,
      size: bytes.byteLength,
    }))
  }

  return Object.freeze({ root, directory, files: Object.freeze(files) })
}

async function runGit(
  request: ReactionOperationRequest,
  input: ReactionGitInput,
): Promise<ReactorGitCloneOutput | ReactorGitCommitOutput | ReactorGitPushOutput> {
  const sandbox = await requireSandbox(request)
  if (input.operation === "clone") {
    const target = normalizeRelativePath(input.target)
    const path = joinPath(sandbox.workspaceRoot, target)
    const reused = await sandbox.exists(joinPath(path, ".git"))
    if (!reused) {
      const args = ["clone"]
      if (input.depth !== undefined) args.push("--depth", String(input.depth))
      if (input.ref) args.push("--branch", input.ref)
      args.push("--", input.url, path)
      await assertCommand(sandbox, "git", args, sandbox.workspaceRoot)
    }
    const sha = (await assertCommand(sandbox, "git", ["rev-parse", "HEAD"], path)).output.trim()
    return Object.freeze({
      target,
      path,
      url: input.url,
      ...(input.ref ? { ref: input.ref } : {}),
      ...(sha ? { commitSha: sha } : {}),
      status: reused ? "reused" : "cloned",
    })
  }

  const path = resolveWorkspacePath(sandbox.workspaceRoot, input.repository)
  if (input.operation === "commit") {
    const status = await assertCommand(sandbox, "git", ["status", "--porcelain"], path)
    const changedFiles = status.output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line: string) => line.slice(3).trim())
    if (changedFiles.length === 0) {
      return Object.freeze({ path, status: "unchanged", message: input.message, changedFiles: [] })
    }
    if (input.all !== false) await assertCommand(sandbox, "git", ["add", "-A"], path)
    const env = {
      ...(input.authorName ? { GIT_AUTHOR_NAME: input.authorName, GIT_COMMITTER_NAME: input.authorName } : {}),
      ...(input.authorEmail ? { GIT_AUTHOR_EMAIL: input.authorEmail, GIT_COMMITTER_EMAIL: input.authorEmail } : {}),
    }
    await assertCommand(sandbox, "git", ["commit", "-m", input.message], path, env)
    const sha = (await assertCommand(sandbox, "git", ["rev-parse", "HEAD"], path)).output.trim()
    return Object.freeze({
      path,
      status: "committed",
      message: input.message,
      commitSha: sha,
      changedFiles: Object.freeze(changedFiles),
    })
  }

  const remote = input.remote ?? "origin"
  const args = ["push"]
  if (input.setUpstream) args.push("--set-upstream")
  if (input.forceWithLease) args.push("--force-with-lease")
  args.push(remote, input.ref)
  const pushed = await assertCommand(sandbox, "git", args, path)
  return Object.freeze({
    path,
    remote,
    ref: input.ref,
    status: "pushed",
    stdout: pushed.output,
    command: ["git", ...args].join(" "),
  })
}

async function assertCommand(
  sandbox: any,
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
) {
  const result = await sandbox.exec({ command, args, cwd, env })
  if (!result.success) {
    throw new Error(`reaction_command_failed:${[command, ...args].join(" ")}:${result.error || result.output}`)
  }
  return result
}

function resolveWorkspacePath(root: string, value: string | undefined) {
  if (!value?.trim()) return root
  const normalized = value.trim().replace(/\\/g, "/")
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/")) {
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "")
    if (normalized !== normalizedRoot && !normalized.startsWith(`${normalizedRoot}/`)) {
      throw new Error(`reaction_workspace_path_outside_root:${value}`)
    }
    return value
  }
  return joinPath(root, normalizeRelativePath(normalized))
}

function normalizeRelativePath(value: string) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (!normalized || normalized.split("/").some(part => part === ".." || part === ".")) {
    throw new Error(`reaction_workspace_path_invalid:${value}`)
  }
  return normalized
}

function safeFilename(value: string) {
  const filename = value.replace(/\\/g, "/").split("/").pop() ?? "file"
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-") || "file"
}

function joinPath(root: string, ...parts: string[]) {
  const separator = root.includes("\\") && !root.startsWith("/") ? "\\" : "/"
  return [root.replace(/[\\/]+$/, ""), ...parts.map(part => part.replace(/^[\\/]+|[\\/]+$/g, ""))]
    .filter(Boolean)
    .join(separator)
}

async function loadFileBytes(fileId: string, url: unknown) {
  if (typeof url !== "string" || !url) {
    throw new Error(`reaction_workspace_file_url_required:${fileId}`)
  }
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",")
    if (comma < 0) throw new Error(`reaction_workspace_file_url_invalid:${fileId}`)
    const metadata = url.slice(5, comma)
    const data = url.slice(comma + 1)
    return new Uint8Array(
      metadata.includes(";base64")
        ? Buffer.from(data, "base64")
        : Buffer.from(decodeURIComponent(data), "utf8"),
    )
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`reaction_workspace_file_fetch_failed:${fileId}:${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  return left.every((value, index) => value === right[index])
}

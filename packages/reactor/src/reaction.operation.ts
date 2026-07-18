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
  contextEventFilesPhysicalLink,
  getContextRuntimeServices,
  type ContextEvent,
  type ContextPartEnvelope,
  type ContextRuntimeServiceHandle,
  type DomainEventDraftLike,
  uuidV5,
} from "@ekairos/events"
import { Sandbox } from "@ekairos/sandbox/sandbox"
import { z } from "zod"

import { runReactionEngineAgent } from "./agent.js"
import { resolveCausalEvents } from "./reaction-causality.js"
import { collectEventFileReferences } from "./reaction-files.js"
import { buildAgentModelMessages } from "./reaction-view.js"
import {
  openReactionStream,
  type ReactionStreamController,
} from "./reaction.stream.js"
import type {
  AnyReactionEngine,
  ReactionModel,
  ReactionToolAction,
  ReactorGitCloneOutput,
  ReactorGitCommitOutput,
  ReactorGitPushOutput,
  ReactorInitialContext,
  ReactorLoadFilesOutput,
  ReactorShellRunInput,
  ReactorShellRunOutput,
  ReactorStoreFilesInput,
  ReactorStoreFilesOutput,
  ReactorWorkspace,
} from "./reactor.js"
import {
  appendWorkspacePath,
  contextWorkspacePath,
  relativeWorkspaceFile,
  resolveContextWorkspacePath,
  workspaceKey,
  type ReactorPath,
} from "./workspace-path.js"
import type {
  DatasetAdapterHandle,
} from "./dataset-adapter.js"
import type {
  ReactionGitInput,
  ReactionOperation,
  ReactionOperationActionRef,
  ReactionOperationRequest,
  ReactionOperationResult,
} from "./reaction.operation.contract.js"

type AnyDomainAction = DomainActionRegistration<any, any, any, any>
const AGENT_EFFECT_EVENT_NAMESPACE = "d86ced13-b64c-449c-a4c0-c41bd1241068"

export async function runReactionOperation(
  request: ReactionOperationRequest,
): Promise<ReactionOperationResult> {
  const { store } = await getContextRuntimeServices(request.runtime)
  const existingReaction = await store.getReaction(request.reactionId)
  if (existingReaction?.status === "completed") {
    const effectId = existingReaction.effectIds[existingReaction.effectIds.length - 1]
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

  let stream: ReactionStreamController | undefined
  try {
    if (request.operation.kind === "agent") {
      stream = await openReactionStream({
        runtime: request.runtime,
        reactionId: request.reactionId,
      })
    }
    const event = await runOperation(request, stream)
    await stream?.complete()
    await store.appendReactionEffect(request.reactionId, event.id)
    const current = await store.getReaction(request.reactionId)
    const effectIds = current?.effectIds ?? [event.id]
    await store.completeReaction(request.reactionId, "completed", effectIds)
    return Object.freeze({ event })
  } catch (error) {
    await stream?.fail(error).catch(() => undefined)
    const current = await store.getReaction(request.reactionId).catch(() => null)
    await store.completeReaction(
      request.reactionId,
      "failed",
      current?.effectIds ?? [],
      error,
    ).catch(() => undefined)
    throw error
  }
}

async function runOperation(
  request: ReactionOperationRequest,
  stream?: ReactionStreamController,
): Promise<ContextEvent> {
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
    const actions = resolveEngineActions(request, operation.actions)
    const sandbox = await openSandbox(request)
    const workspace = sandbox ? await prepareReactionWorkspace(request, sandbox) : undefined
    if (operation.path && !workspace) throw new Error("reaction_agent_path_requires_sandbox")
    const given = await hydrateEvents(request.runtime, request.causeIds)
    const messages = await buildAgentModelMessages({
      runtime: request.runtime,
      reactionKey: request.definition,
      instruction: operation.instruction,
      context: request.context,
      events: given,
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
        given,
        messages,
        instruction: operation.instruction,
        ...(output ? { output } : {}),
        ...(operation.model ? { model: operation.model } : {}),
        ...(operation.maxRounds === undefined ? {} : { maxRounds: operation.maxRounds }),
        actions,
        ...(stream ? { stream } : {}),
        ...(sandbox && workspace
          ? {
              sandbox,
              workspaceRoot: resolveContextWorkspacePath(
                sandbox.workspaceRoot,
                request.context.ref.id,
                operation.path ?? workspace.contextPath,
              ),
              workspace: {
                ...workspace,
                path: operation.path ?? workspace.contextPath,
              },
            }
          : {}),
      },
      effects: {
        id: key => uuidV5(`${request.eventId}:${key}`, AGENT_EFFECT_EVENT_NAMESPACE),
        async record(draft) {
          const event = await Events(request.runtime).create({
            id: draft.id,
            type: draft.type,
            payload: draft.payload,
            contextId: request.context.ref.id,
            metadata: {
              ...operationMetadata(request),
              instruction: operation.instruction,
              ...draft.metadata,
              ...(stream
                ? { streamId: stream.streamId, streamClientId: stream.clientId }
                : {}),
            },
            parts: draft.parts,
          })
          const { store } = await getContextRuntimeServices(request.runtime)
          await store.appendReactionEffect(request.reactionId, event.id)
          return event
        },
      },
    })
    return result.event
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
        { reactionId: request.reactionId },
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

  if (operation.kind === "loadFiles") {
    const result = await materializeFiles(request)
    return await createOperationEvent(request, result, [Part.json(result)])
  }

  if (operation.kind === "storeFiles") {
    const result = await persistFiles(request, operation.input)
    return await createOperationEvent(
      request,
      result.output,
      [Part.json(result.output)],
      {},
      result.fileIds,
    )
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
  fileIds: readonly string[] = [],
) {
  return await Events(request.runtime).create({
    id: request.eventId,
    type: `context.${operationType(request.operation)}`,
    payload,
    contextId: request.context.ref.id,
    metadata: { ...operationMetadata(request), ...metadata },
    ...(fileIds.length > 0
      ? {
          links: { files: [...fileIds] },
          physicalLinks: { files: contextEventFilesPhysicalLink },
        }
      : {}),
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
  request: ReactionOperationRequest,
  refs: readonly ReactionOperationActionRef[],
) {
  return Object.freeze(Object.fromEntries(refs.map(ref => {
    const action = resolveAction(request.runtime, ref)
    const binding = getDomainActionBinding(action)!
    const tool: ReactionToolAction = Object.freeze({
      description: action.description,
      input: action.input,
      output: action.output,
      async execute(input: unknown, reactionId) {
        const prepared = await prepareDomainActionExecution(
          request.runtime as any,
          action,
          input as any,
        )
        return (await executeDomainAction(
          request.runtime as any,
          action,
          prepared,
          { reactionId },
        )).output
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
  return await resolveCausalEvents({
    sourceIds: ids,
    getEvent: id => store.getEvent(id),
    getReaction: id => store.getReaction(id),
  })
}

async function openSandbox(request: ReactionOperationRequest) {
  if (request.sandboxId === false) return undefined
  return await Sandbox.open(request.runtime as any, request.sandboxId)
}

async function requireReactionWorkspace(request: ReactionOperationRequest) {
  const sandbox = await openSandbox(request)
  if (!sandbox) throw new Error("reaction_sandbox_not_configured")
  const workspace = await prepareReactionWorkspace(request, sandbox)
  return Object.freeze({ sandbox, workspace })
}

async function prepareReactionWorkspace(
  request: ReactionOperationRequest,
  sandbox: NonNullable<Awaited<ReturnType<typeof openSandbox>>>,
): Promise<ReactorWorkspace> {
  const contextPath = contextWorkspacePath(request.context.ref.id)
  const sessionKey = workspaceKey(request.sessionId)
  const reactionKey = workspaceKey(request.reactionId)
  const artifactsPath = contextWorkspacePath(
    request.context.ref.id,
    "artifacts",
    sessionKey,
    reactionKey,
  )
  const tmpPath = contextWorkspacePath(
    request.context.ref.id,
    "tmp",
    sessionKey,
    reactionKey,
  )
  await ensureWorkspaceManifest(
    sandbox,
    resolveContextWorkspacePath(
      sandbox.workspaceRoot,
      request.context.ref.id,
      appendWorkspacePath(contextPath, "manifest.json"),
    ),
    {
      schema: "ekairos.context-workspace/v1",
      contextId: request.context.ref.id,
    },
  )
  await ensureWorkspaceManifest(
    sandbox,
    resolveContextWorkspacePath(
      sandbox.workspaceRoot,
      request.context.ref.id,
      appendWorkspacePath(artifactsPath, "manifest.json"),
    ),
    {
      schema: "ekairos.reaction-artifacts/v1",
      contextId: request.context.ref.id,
      sessionId: request.sessionId,
      reactionId: request.reactionId,
    },
  )
  return Object.freeze({
    contextPath,
    path: contextPath,
    artifactsPath,
    tmpPath,
  })
}

async function ensureWorkspaceManifest(
  sandbox: NonNullable<Awaited<ReturnType<typeof openSandbox>>>,
  path: string,
  value: Readonly<Record<string, string>>,
) {
  if (await sandbox.exists(path)) return
  await sandbox.writeFile({
    path,
    content: `${JSON.stringify(value, null, 2)}\n`,
  })
}

async function runShell(
  request: ReactionOperationRequest,
  input: ReactorShellRunInput,
): Promise<ReactorShellRunOutput> {
  if (!input.command?.trim()) throw new Error("reaction_shell_command_required")
  const { sandbox, workspace } = await requireReactionWorkspace(request)
  const path = input.path ?? workspace.contextPath
  const physicalPath = resolveContextWorkspacePath(
    sandbox.workspaceRoot,
    request.context.ref.id,
    path,
  )
  const result: any = await sandbox.exec({
    command: input.command,
    args: [...(input.args ?? [])],
    cwd: physicalPath,
    env: {
      ...(input.env ?? {}),
      EKAIROS_CONTEXT: resolveContextWorkspacePath(
        sandbox.workspaceRoot,
        request.context.ref.id,
        workspace.contextPath,
      ),
      EKAIROS_ARTIFACTS: resolveContextWorkspacePath(
        sandbox.workspaceRoot,
        request.context.ref.id,
        workspace.artifactsPath,
      ),
      EKAIROS_TMP: resolveContextWorkspacePath(
        sandbox.workspaceRoot,
        request.context.ref.id,
        workspace.tmpPath,
      ),
    },
    timeoutMs: input.timeoutMs,
  })
  const exitCode = typeof result.exitCode === "number" ? result.exitCode : result.success === false ? 1 : 0
  return Object.freeze({
    success: typeof result.success === "boolean" ? result.success : exitCode === 0,
    exitCode,
    output: typeof result.output === "string" ? result.output : "",
    error: typeof result.error === "string" ? result.error : "",
    command: [input.command, ...(input.args ?? [])].join(" "),
    path,
  })
}

async function materializeFiles(
  request: ReactionOperationRequest,
): Promise<ReactorLoadFilesOutput> {
  const { sandbox } = await requireReactionWorkspace(request)
  const events = await hydrateEvents(request.runtime, request.causeIds)
  const refs = collectEventFileReferences(events)
  const path = contextWorkspacePath(request.context.ref.id, "files")
  const db = await request.runtime.db()
  const files: ReactorLoadFilesOutput["files"][number][] = []

  for (const ref of refs) {
    const result = await db.query({
      $files: { $: { where: { id: ref.fileId }, limit: 1 } },
    } as any)
    const file = result?.$files?.[0]
    if (!file) throw new Error(`reaction_file_not_found:${ref.fileId}`)
    const fileId = String(file.id)
    const name = safeFilename(String(file.path ?? file.name ?? fileId))
    const filePath = contextWorkspacePath(
      request.context.ref.id,
      "files",
      workspaceKey(fileId),
      name,
    )
    const physicalPath = resolveContextWorkspacePath(
      sandbox.workspaceRoot,
      request.context.ref.id,
      filePath,
    )
    const bytes = await loadFileBytes(fileId, file.url)
    const exists = await sandbox.exists(physicalPath)
    let status: "created" | "reused" = "created"
    if (exists) {
      const current = await sandbox.readFile(physicalPath)
      if (sameBytes(current, bytes)) {
        status = "reused"
      } else {
        throw new Error(`reaction_file_identity_conflict:${fileId}`)
      }
    } else {
      await sandbox.writeFile({ path: physicalPath, content: bytes })
    }
    files.push(Object.freeze({
      fileId,
      name,
      ...(file["content-type"] ?? file.contentType
        ? { mediaType: String(file["content-type"] ?? file.contentType) }
        : {}),
      path: filePath,
      status,
      size: bytes.byteLength,
      origins: ref.origins,
    }))
  }

  return Object.freeze({ path, files: Object.freeze(files) })
}

async function persistFiles(
  request: ReactionOperationRequest,
  input: ReactorStoreFilesInput,
): Promise<Readonly<{
  output: ReactorStoreFilesOutput
  fileIds: readonly string[]
}>> {
  const { sandbox } = await requireReactionWorkspace(request)
  resolveContextWorkspacePath(
    sandbox.workspaceRoot,
    request.context.ref.id,
    input.path,
  )
  const selected = (Array.isArray(input.files) ? input.files : [input.files])
    .map(relativeWorkspaceFile)
  if (selected.length === 0) throw new Error("reaction_store_files_required")
  const db = await request.runtime.db()
  const files: ReactorStoreFilesOutput["files"][number][] = []
  const fileIds: string[] = []

  for (const [index, relative] of selected.entries()) {
    const logicalPath = appendWorkspacePath(input.path, ...relative.split("/"))
    const physicalPath = resolveContextWorkspacePath(
      sandbox.workspaceRoot,
      request.context.ref.id,
      logicalPath,
    )
    if (!await sandbox.exists(physicalPath)) {
      throw new Error(`reaction_store_file_not_found:${logicalPath}`)
    }
    const bytes = await sandbox.readFile(physicalPath)
    const name = safeFilename(relative)
    const mediaType = mediaTypeForFilename(name)
    const uploaded = await db.storage.uploadFile(
      `/contexts/${request.context.ref.id}/events/${request.eventId}/${index}-${name}`,
      Buffer.from(bytes),
      { contentType: mediaType, contentDisposition: name },
    )
    const fileId = String((uploaded as any)?.data?.id ?? "")
    if (!fileId) throw new Error(`reaction_store_file_upload_failed:${logicalPath}`)
    fileIds.push(fileId)
    files.push(Object.freeze({
      fileId,
      name,
      mediaType,
      path: logicalPath,
      size: bytes.byteLength,
    }))
  }

  return Object.freeze({
    output: Object.freeze({ path: input.path, files: Object.freeze(files) }),
    fileIds: Object.freeze(fileIds),
  })
}

async function runGit(
  request: ReactionOperationRequest,
  input: ReactionGitInput,
): Promise<ReactorGitCloneOutput | ReactorGitCommitOutput | ReactorGitPushOutput> {
  const { sandbox } = await requireReactionWorkspace(request)
  if (input.operation === "clone") {
    if (!input.key?.trim()) throw new Error("reaction_git_repository_key_required")
    if (!input.url?.trim()) throw new Error("reaction_git_repository_url_required")
    const path = contextWorkspacePath(
      request.context.ref.id,
      "repositories",
      workspaceKey(input.key),
      "checkout",
    )
    const physicalPath = resolveContextWorkspacePath(
      sandbox.workspaceRoot,
      request.context.ref.id,
      path,
    )
    const metadataPath = resolveContextWorkspacePath(
      sandbox.workspaceRoot,
      request.context.ref.id,
      contextWorkspacePath(
        request.context.ref.id,
        "repositories",
        workspaceKey(input.key),
        "repository.json",
      ),
    )
    const reused = await sandbox.exists(joinPath(physicalPath, ".git"))
    if (!reused) {
      const args = ["clone"]
      if (input.depth !== undefined) args.push("--depth", String(input.depth))
      if (input.ref) args.push("--branch", input.ref)
      args.push("--", input.url, physicalPath)
      const contextPhysicalPath = resolveContextWorkspacePath(
        sandbox.workspaceRoot,
        request.context.ref.id,
        contextWorkspacePath(request.context.ref.id),
      )
      await assertCommand(sandbox, "git", args, contextPhysicalPath)
      await sandbox.writeFile({
        path: metadataPath,
        content: `${JSON.stringify({
          schema: "ekairos.repository/v1",
          key: input.key,
          url: input.url,
          ref: input.ref ?? null,
        }, null, 2)}\n`,
      })
    } else {
      if (!await sandbox.exists(metadataPath)) {
        throw new Error(`reaction_git_repository_metadata_missing:${input.key}`)
      }
      const metadata = JSON.parse(Buffer.from(await sandbox.readFile(metadataPath)).toString("utf8"))
      if (metadata.url !== input.url || (metadata.ref ?? undefined) !== input.ref) {
        throw new Error(`reaction_git_repository_identity_conflict:${input.key}`)
      }
      const remote = (await assertCommand(
        sandbox,
        "git",
        ["remote", "get-url", "origin"],
        physicalPath,
      )).output.trim()
      if (remote !== input.url) {
        throw new Error(`reaction_git_repository_remote_conflict:${input.key}`)
      }
    }
    const sha = (await assertCommand(
      sandbox,
      "git",
      ["rev-parse", "HEAD"],
      physicalPath,
    )).output.trim()
    return Object.freeze({
      key: input.key,
      path,
      url: input.url,
      ...(input.ref ? { ref: input.ref } : {}),
      ...(sha ? { commitSha: sha } : {}),
      status: reused ? "reused" : "cloned",
    })
  }

  const path = input.path
  const physicalPath = resolveContextWorkspacePath(
    sandbox.workspaceRoot,
    request.context.ref.id,
    path,
  )
  if (!await sandbox.exists(joinPath(physicalPath, ".git"))) {
    throw new Error(`reaction_git_repository_not_found:${path}`)
  }
  if (input.operation === "commit") {
    const status = await assertCommand(sandbox, "git", ["status", "--porcelain"], physicalPath)
    const changedFiles = status.output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line: string) => line.slice(3).trim())
    if (changedFiles.length === 0) {
      return Object.freeze({ path, status: "unchanged", message: input.message, changedFiles: [] })
    }
    if (input.all !== false) await assertCommand(sandbox, "git", ["add", "-A"], physicalPath)
    const env = {
      ...(input.authorName ? { GIT_AUTHOR_NAME: input.authorName, GIT_COMMITTER_NAME: input.authorName } : {}),
      ...(input.authorEmail ? { GIT_AUTHOR_EMAIL: input.authorEmail, GIT_COMMITTER_EMAIL: input.authorEmail } : {}),
    }
    await assertCommand(sandbox, "git", ["commit", "-m", input.message], physicalPath, env)
    const sha = (await assertCommand(
      sandbox,
      "git",
      ["rev-parse", "HEAD"],
      physicalPath,
    )).output.trim()
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
  const pushed = await assertCommand(sandbox, "git", args, physicalPath)
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

function safeFilename(value: string) {
  const filename = value.replace(/\\/g, "/").split("/").pop() ?? "file"
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-") || "file"
}

function mediaTypeForFilename(filename: string) {
  const extension = filename.toLowerCase().split(".").pop()
  const types: Readonly<Record<string, string>> = {
    csv: "text/csv",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    json: "application/json",
    md: "text/markdown",
    pdf: "application/pdf",
    png: "image/png",
    txt: "text/plain",
    webp: "image/webp",
  }
  return extension && types[extension] ? types[extension] : "application/octet-stream"
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

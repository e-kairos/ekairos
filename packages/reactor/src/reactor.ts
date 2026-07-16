import type { LanguageModel, ModelMessage } from "ai"
import type { DomainEventConstructor, DomainEventLinkDefinition } from "@ekairos/domain"
import type {
  ContextEvent,
  ContextPartEnvelope,
  ContextRuntimeServiceHandle,
  ContextSandboxHandle,
  DomainEventItem,
} from "@ekairos/events"
import type { z } from "zod"

export type ReactionModel = string | (() => Promise<LanguageModel>)

export type ReactionToolAction = Readonly<{
  description?: string
  input: z.ZodType
  output: z.ZodType
  execute(input: unknown): Promise<unknown>
}>
export type ReactionEngineActions = Readonly<Record<string, ReactionToolAction>>

export type ReactorInitialContext<TContext> = Readonly<{
  ref: Readonly<{ id: string; key: string | null }>
  content: Readonly<TContext>
  previous?: Readonly<TContext>
}>

export type ReactionEngineInput<
  TContext = unknown,
  TOutput = unknown,
  TActions extends ReactionEngineActions = ReactionEngineActions,
> = Readonly<{
  reactionKey: string
  runtime: ContextRuntimeServiceHandle
  context: ReactorInitialContext<TContext>
  trigger: ContextEvent
  sessionId: string
  reactionId: string
  given: readonly ContextEvent[]
  messages: readonly ModelMessage[]
  instruction: string
  output?: z.ZodType<TOutput>
  model?: ReactionModel
  maxRounds?: number
  actions: TActions
  sandbox?: ContextSandboxHandle
  workspaceRoot?: string
}>

export type ReactionEngineResult<TOutput = unknown> = Readonly<{
  output: TOutput
  parts?: readonly ContextPartEnvelope[]
  metadata?: Readonly<Record<string, unknown>>
}>

export interface ReactionEngine<TContext = unknown> {
  agent<TOutput, TActions extends ReactionEngineActions>(
    input: ReactionEngineInput<TContext, TOutput, TActions>,
  ): Promise<ReactionEngineResult<TOutput>>
}

/** Built-in AI SDK engine selected explicitly with `ai({ model })`. */
export type AiReactionEngine = Readonly<{
  kind: "ekairos.ai"
  model: ReactionModel
  maxRounds?: number
}>

export type AnyReactionEngine<TContext = unknown> =
  | ReactionEngine<TContext>
  | AiReactionEngine

export function ai(config: {
  model: ReactionModel
  maxRounds?: number
}): AiReactionEngine {
  const model = config?.model
  if (
    typeof model !== "function" &&
    (typeof model !== "string" || !model.trim())
  ) {
    throw new Error("ai() engine requires a model id or async model factory.")
  }
  return Object.freeze({
    kind: "ekairos.ai" as const,
    model: typeof model === "string" ? model.trim() : model,
    ...(config.maxRounds === undefined ? {} : { maxRounds: config.maxRounds }),
  })
}

export function isAiEngine(value: unknown): value is AiReactionEngine {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as AiReactionEngine).kind === "ekairos.ai",
  )
}

export type ReactionSandboxResolverInput<TContext = unknown> = Readonly<{
  runtime: ContextRuntimeServiceHandle
  context: TContext
  trigger: ContextEvent
  reactionKey: string
}>

export type ReactionSandbox<TContext = unknown> =
  | string
  | ((input: ReactionSandboxResolverInput<TContext>) => string | Promise<string>)

export type TriggerEventItem<TTrigger extends DomainEventConstructor<any, any, any, any, any>> =
  DomainEventItem<
    TTrigger extends { payload: z.ZodType<infer Payload> } ? Payload : never
  > & {
    type: TTrigger["kind"]
    domain: TTrigger["domain"]
    name: TTrigger["name"]
    links: TTrigger extends {
      links: infer Links extends Record<string, DomainEventLinkDefinition>
    }
      ? Readonly<{
          [Alias in keyof Links]?: Links[Alias]["has"] extends "one"
            ? string
            : string | readonly string[]
        }>
      : never
  }

export type ReactorShellRunInput = Readonly<{
  command: string
  args?: readonly string[]
  cwd?: string
  env?: Readonly<Record<string, string>>
  timeoutMs?: number
}>

export type ReactorShellRunOutput = Readonly<{
  success: boolean
  exitCode: number
  output: string
  error: string
  command: string
  cwd?: string
}>

export type ReactorWorkspaceInput = Readonly<{
  files: string | readonly string[]
  directory?: string
  conflict?: "verify" | "replace" | "error"
}>

export type ReactorWorkspaceFile = Readonly<{
  ref: string
  fileId: string
  filename: string
  mediaType?: string
  path: string
  status: "created" | "reused" | "replaced"
  size: number
}>

export type ReactorWorkspaceOutput = Readonly<{
  root: string
  directory: string
  files: readonly ReactorWorkspaceFile[]
}>

export type ReactorGitCloneOutput = Readonly<{
  target: string
  path: string
  url: string
  ref?: string
  commitSha?: string
  status: "cloned" | "reused"
}>

export type ReactorGitCommitOutput = Readonly<{
  path: string
  status: "committed" | "unchanged"
  message: string
  commitSha?: string
  changedFiles: readonly string[]
}>

export type ReactorGitPushOutput = Readonly<{
  path: string
  remote: string
  ref: string
  status: "pushed"
  stdout: string
  command: string
}>

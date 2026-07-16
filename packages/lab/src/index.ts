import {
  defineReaction,
  type ReactionDefinitionOptions,
  type ReactionDefinition,
  type ReactionEngine,
  type ReactionRun,
} from "@ekairos/reactor"
import { z } from "zod"

export const labCodingContextSchema = z.object({
  repositoryUrl: z.string().url(),
  repositoryRef: z.string().optional(),
  repositoryPath: z.string().min(1).default("repository"),
  request: z.string().min(1),
  commitMessage: z.string().min(1).optional(),
  push: z.object({
    remote: z.string().min(1).default("origin"),
    branch: z.string().min(1),
  }).optional(),
})

export const labCodingResultSchema = z.object({
  status: z.enum(["completed", "needs_followup"]),
  summary: z.string().min(1),
  repositoryPath: z.string().min(1),
  changedFiles: z.array(z.string()).default([]),
  verification: z.string().optional(),
  commit: z.object({
    status: z.enum(["committed", "unchanged"]),
    commitSha: z.string().optional(),
    changedFiles: z.array(z.string()).default([]),
  }).optional(),
  push: z.object({
    status: z.literal("pushed"),
    remote: z.string(),
    ref: z.string(),
  }).optional(),
})

export type LabCodingContext = z.infer<typeof labCodingContextSchema>
export type LabCodingResult = z.infer<typeof labCodingResultSchema>
export type LabEnv = Record<string, unknown>

type LabReactionRun = ReactionRun<LabCodingContext, any, any>
type LabCompletionDraft = Parameters<
  ReturnType<LabReactionRun["given"]>["emit"]
>[0]
type LabCompletionEffect = Awaited<ReturnType<
  ReturnType<LabReactionRun["given"]>["emit"]
>>

export type LabCodingReactionOptions = {
  key?: string
  trigger: Parameters<typeof defineReaction>[0]
  scope: ReactionDefinitionOptions<LabCodingContext, any>["scope"]
  engine: ReactionEngine<LabCodingContext>
  sandbox: ReactionDefinitionOptions<LabCodingContext, any>["sandbox"]
  completed(result: LabCodingResult): LabCompletionDraft
}

function codingInstructions(params: {
  request: string
  repositoryPath: string
  sandboxId?: string
}) {
  return [
    "You are operating inside an Ekairos Lab coding workspace.",
    "Use the causal operation history as the factual workspace trace.",
    `Repository path: ${params.repositoryPath}`,
    params.sandboxId ? `Sandbox ID: ${params.sandboxId}` : "",
    "Return a concise typed result. Do not claim changes unless they were actually made.",
    "",
    "Request:",
    params.request,
  ].filter(Boolean).join("\n")
}

export function defineLabCodingReaction(
  options: LabCodingReactionOptions,
): ReactionDefinition<LabCodingContext, any, any, LabCompletionEffect> {
  return defineReaction(
    options.trigger,
    {
      key: options.key ?? "lab.coding",
      scope: options.scope,
      engine: options.engine,
      sandbox: options.sandbox,
    },
    async reaction => {
      const context = labCodingContextSchema.parse(reaction.context.content)
      const repo = await reaction.given(reaction.trigger).git({
        operation: "clone",
        target: context.repositoryPath,
        url: context.repositoryUrl,
        ref: context.repositoryRef,
      })

      const inspected = await reaction.given(repo).shell({
        command: "git",
        args: ["-C", repo.payload.path, "status", "--short"],
      })

      const computed = await reaction.given(inspected).agent({
        instruction: codingInstructions({
          request: context.request,
          repositoryPath: repo.payload.path,
          sandboxId: reaction.sandboxId,
        }),
        output: labCodingResultSchema,
      })

      let result = computed.payload
      if (context.push) {
        const commit = await reaction.given(computed).git({
          operation: "commit",
          repository: repo.payload.path,
          message: context.commitMessage ?? context.request,
          all: true,
        })
        const pushed = await reaction.given(commit).git({
          operation: "push",
          repository: repo.payload.path,
          remote: context.push.remote,
          ref: context.push.branch,
          setUpstream: true,
        })

        result = labCodingResultSchema.parse({
          ...computed.payload,
          commit: {
            status: commit.payload.status,
            commitSha: commit.payload.commitSha,
            changedFiles: commit.payload.changedFiles,
          },
          push: {
            status: pushed.payload.status,
            remote: pushed.payload.remote,
            ref: pushed.payload.ref,
          },
        })
        return await reaction.given(pushed).emit(options.completed(result))
      }

      return await reaction.given(computed).emit(options.completed(result))
    },
  )
}

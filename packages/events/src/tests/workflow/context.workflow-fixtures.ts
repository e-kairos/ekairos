import { tool } from "ai"
import { z } from "zod"

import {
  createContext,
  createScriptedReactor,
  type ContextItem,
  type ContextToolExecuteContext,
} from "../../index.ts"
import { EventsTestRuntime } from "./context.test-runtime.ts"

export type WorkflowSmokeEnv = {
  mode: "success" | "tool-error" | "scripted"
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

export function readRows(queryResult: unknown, key: string): Record<string, unknown>[] {
  const root = asRecord(queryResult)
  if (!root) return []
  const value = root[key]
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

export function readString(
  row: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!row) return null
  const value = row[key]
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return null
}

export function buildTriggerEvent(text = "ping"): ContextItem {
  return {
    id: globalThis.crypto.randomUUID(),
    type: "input",
    channel: "web",
    createdAt: new Date().toISOString(),
    content: {
      parts: [{ type: "text", text }],
    },
  }
}

async function executeEchoTool(
  { message }: { message: string },
  ctx: ContextToolExecuteContext<any, WorkflowSmokeEnv>,
  mode: WorkflowSmokeEnv["mode"],
) {
  "use step"

  if (mode === "tool-error") {
    throw new Error("echo_failed")
  }

  const db = await ctx.runtime.db()
  return {
    type: "json" as const,
    value: {
      ok: true,
      message,
      mode,
      runtimeMode: mode,
      contextId: String(ctx.context.id),
      stepId: String(ctx.stepId),
      hasDb: Boolean(db),
    },
  }
}

function createEchoAction(mode: WorkflowSmokeEnv["mode"]) {
  return tool({
    description: "Return the input payload as a simple echo response.",
    inputSchema: z.object({ message: z.string() }),
    execute: (input, ctx) => executeEchoTool(input, ctx, mode),
  })
}

function createStorySmoke(key: string) {
  return createContext<WorkflowSmokeEnv>(key)
    .context((ctx, env) => ({
      ...(ctx.content ?? {}),
      mode: env.mode,
    }))
    .reactor(
      createScriptedReactor({
        repeatLast: true,
        steps: [
          {
            assistantEvent: {
              content: {
                parts: [
                  { type: "text", text: "Scripted reactor requesting echo." },
                  {
                    type: "tool-echo",
                    toolCallId: "scripted-smoke-tool-call",
                    input: { message: "ping" },
                  },
                ],
              },
            },
            actionRequests: [
              {
                actionRef: "scripted-smoke-tool-call",
                actionName: "echo",
                input: { message: "ping" },
              },
            ],
            messagesForModel: [],
          },
        ],
      }),
    )
    .build()
}

export const storySmoke = createStorySmoke("story.smoke")
export const childStorySmoke = createStorySmoke("story.smoke.child")
export const storySmokeExpandedEvents = createContext<WorkflowSmokeEnv>("story.smoke.expanded-events")
  .context((ctx, env) => ({
    ...(ctx.content ?? {}),
    mode: env.mode,
  }))
  .expandEvents((events) => [
    ...events,
    {
      id: `derived:${events[0]?.id ?? "missing"}:canvas`,
      type: "output",
      channel: "web",
      createdAt: new Date().toISOString(),
      content: {
        parts: [
          {
            type: "content",
            state: "done",
            content: [
              {
                type: "text",
                text: "Derived canvas snapshot reference.",
              },
            ],
          },
        ],
      },
    } satisfies ContextItem,
  ])
  .reactor(
    createScriptedReactor({
      repeatLast: true,
      steps: [
        (params) => {
          const sawExpandedEvent = params.events.some((event) =>
            String(event.id).startsWith("derived:") &&
            JSON.stringify(event.content.parts ?? []).includes("Derived canvas snapshot reference"),
          )
          if (!sawExpandedEvent) {
            throw new Error("expanded_events_missing")
          }
          return {
            assistantEvent: {
              content: {
                parts: [{ type: "text", text: "Expanded event received." }],
              },
            },
            actionRequests: [],
            messagesForModel: [],
          }
        },
      ],
    }),
  )
  .build()

export async function runSmokeContext(params: {
  context: typeof storySmoke
  runtime: EventsTestRuntime<WorkflowSmokeEnv>
  triggerText?: string
  parent?: {
    contextId?: string
    executionId?: string
    triggerEventId?: string
    reactionEventId?: string
  } | null
}) {
  const shell = await params.context.react(
    buildTriggerEvent(params.triggerText ?? "workflow trigger"),
    {
      runtime: params.runtime,
      context: null,
      parent: params.parent ?? null,
    },
    async (execution) => {
      await execution.prompt("echo", {
        instructions: "Story smoke deterministic workflow.",
        maxModelSteps: 1,
        actions: {
          echo: createEchoAction(execution.state.content?.mode ?? params.runtime.env.mode),
        },
      })
      return execution.end()
    },
  )

  return await shell.run!
}

export type ContextReactWorkflowInput = {
  runtime: EventsTestRuntime<WorkflowSmokeEnv>
  triggerText?: string
}

export type ContextReactWorkflowResult = {
  parentWorkflowRunId: string | null
  contextId: string
  executionId: string
  finalExecutionStatus: string | null
  finalReactionStatus: string | null
}

export async function contextReactParentWorkflow(
  input: ContextReactWorkflowInput,
): Promise<ContextReactWorkflowResult> {
  "use workflow"

  const { getWorkflowMetadata } = await import("workflow")
  const parentWorkflowRunId = getWorkflowMetadata?.()?.workflowRunId
  const finalResult = await runSmokeContext({
    context: storySmoke,
    runtime: input.runtime,
    triggerText: input.triggerText,
  })

  return {
    parentWorkflowRunId:
      parentWorkflowRunId === undefined || parentWorkflowRunId === null
        ? null
        : String(parentWorkflowRunId),
    contextId: String(finalResult.context.id),
    executionId: String(finalResult.execution.id),
    finalExecutionStatus: readString(finalResult.execution as any, "status"),
    finalReactionStatus: readString(finalResult.reaction as any, "status"),
  }
}

export type NestedContextReactWorkflowResult = ContextReactWorkflowResult & {
  childContextId: string
  childExecutionId: string
  childFinalExecutionStatus: string | null
  childFinalReactionStatus: string | null
}

export async function nestedContextReactWorkflow(
  input: ContextReactWorkflowInput,
): Promise<NestedContextReactWorkflowResult> {
  "use workflow"

  const { getWorkflowMetadata } = await import("workflow")
  const parentWorkflowRunId = getWorkflowMetadata?.()?.workflowRunId
  let childContextId = ""
  let childExecutionId = ""
  let childFinalExecutionStatus: string | null = null
  let childFinalReactionStatus: string | null = null

  const shell = await storySmoke.react(
    buildTriggerEvent(input.triggerText ?? "nested parent trigger"),
    {
      runtime: input.runtime,
      context: null,
    },
    async (execution) => {
      await execution.prompt("parent-echo", {
        instructions: "Parent context step.",
        maxModelSteps: 1,
        actions: {
          echo: createEchoAction(input.runtime.env.mode),
        },
      })

      const child = await runSmokeContext({
        context: childStorySmoke,
        runtime: input.runtime,
        triggerText: "nested child trigger",
        parent: execution,
      })
      childContextId = String(child.context.id)
      childExecutionId = String(child.execution.id)
      childFinalExecutionStatus = readString(child.execution as any, "status")
      childFinalReactionStatus = readString(child.reaction as any, "status")

      return execution.end()
    },
  )

  const finalResult = await shell.run!

  return {
    parentWorkflowRunId:
      parentWorkflowRunId === undefined || parentWorkflowRunId === null
        ? null
        : String(parentWorkflowRunId),
    contextId: String(finalResult.context.id),
    executionId: String(finalResult.execution.id),
    finalExecutionStatus: readString(finalResult.execution as any, "status"),
    finalReactionStatus: readString(finalResult.reaction as any, "status"),
    childContextId,
    childExecutionId,
    childFinalExecutionStatus,
    childFinalReactionStatus,
  }
}

export async function expandedContextReactWorkflow(
  input: ContextReactWorkflowInput,
): Promise<ContextReactWorkflowResult> {
  "use workflow"

  const { getWorkflowMetadata } = await import("workflow")
  const parentWorkflowRunId = getWorkflowMetadata?.()?.workflowRunId
  const shell = await storySmokeExpandedEvents.react(
    buildTriggerEvent(input.triggerText ?? "expanded workflow trigger"),
    {
      runtime: input.runtime,
      context: null,
    },
    async (execution) => {
      await execution.prompt("expanded-events", {
        instructions: "Expanded event workflow smoke.",
        maxModelSteps: 1,
      })
      return execution.end()
    },
  )
  const finalResult = await shell.run!

  return {
    parentWorkflowRunId:
      parentWorkflowRunId === undefined || parentWorkflowRunId === null
        ? null
        : String(parentWorkflowRunId),
    contextId: String(finalResult.context.id),
    executionId: String(finalResult.execution.id),
    finalExecutionStatus: readString(finalResult.execution as any, "status"),
    finalReactionStatus: readString(finalResult.reaction as any, "status"),
  }
}

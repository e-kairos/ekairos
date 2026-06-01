/**
 * ## context.action-calls.ts
 *
 * This module isolates the **action-call plumbing** used by `context.engine.ts`.
 *
 * In our runtime, provider tool calls are normalized into semantic `action` event parts.
 * The engine needs to:
 * - extract a normalized list of action requests from `event.content.parts`, and
 * - merge action execution outcomes back into those parts.
 *
 * Keeping this logic here helps `context.engine.ts` read like orchestration, and keeps
 * these transformations testable and reusable.
 */

import type { ContextItem } from "./context.store.js"
import {
  isContextPartEnvelope,
  normalizePartsForPersistence,
  type ContextPartEnvelope,
} from "./context.parts.js"

export type ContextActionCall = {
  actionCallId: string
  actionName: string
  args: any
}

/**
 * Extracts action requests from an event's `parts` array.
 *
 * Also accepts raw AI SDK tool UI parts before persistence normalization.
 */
export function extractActionCallsFromParts(parts: any[] | undefined | null): ContextActionCall[] {
  const safeParts = parts ?? []
  return safeParts.reduce((acc: ContextActionCall[], p: any) => {
    if (isContextPartEnvelope(p) && p.type === "action" && p.content.status === "started") {
      acc.push({
        actionCallId: p.content.actionCallId,
        actionName: p.content.actionName,
        args: p.content.input,
      })
      return acc
    }

    if (typeof p?.type === "string" && p.type.startsWith("tool-")) {
      const actionName = p.type.split("-").slice(1).join("-")
      acc.push({ actionCallId: p.toolCallId, actionName, args: p.input })
    }
    return acc
  }, [])
}

/**
 * Applies an action execution outcome to the matching action part.
 *
 * This does not mutate `parts` — it returns a new array.
 *
 * We match by action name and action call id.
 */
export function applyActionExecutionResultToParts(
  parts: any[],
  actionCall: Pick<ContextActionCall, "actionCallId" | "actionName">,
  execution: { success: boolean; result: any; message?: string },
): any[] {
  const normalized = normalizePartsForPersistence(parts)
  const next: ContextPartEnvelope[] = []
  let insertedResult = false

  for (const part of normalized) {
    next.push(part)
    if (part.type !== "action" || part.content.status !== "started") {
      continue
    }

    if (
      part.content.actionCallId !== actionCall.actionCallId ||
      part.content.actionName !== actionCall.actionName
    ) {
      continue
    }

    next.push(
      execution.success
        ? {
            type: "action",
            content: {
              status: "completed",
              actionCallId: actionCall.actionCallId,
              actionName: actionCall.actionName,
              output: execution.result,
            },
          }
        : {
            type: "action",
            content: {
              status: "failed",
              actionCallId: actionCall.actionCallId,
              actionName: actionCall.actionName,
              error: {
                message: String(execution.message || "Error"),
              },
            },
          },
    )

    insertedResult = true
  }

  if (!insertedResult) {
    next.push(
      execution.success
        ? {
            type: "action",
            content: {
              status: "completed",
              actionCallId: actionCall.actionCallId,
              actionName: actionCall.actionName,
              output: execution.result,
            },
          }
        : {
            type: "action",
            content: {
              status: "failed",
              actionCallId: actionCall.actionCallId,
              actionName: actionCall.actionName,
              error: {
                message: String(execution.message || "Error"),
              },
            },
          },
    )
  }

  return next
}

/**
 * Returns `true` when a given action has a **settled** execution result in an event's parts.
 *
 * We treat an action part as "executed" once it has either:
 * - `state: "output-available"` (success), or
 * - `state: "output-error"` (failure).
 *
 * This is useful for stop/continue logic in `context.shouldContinue(...)` where you want to
 * decide based on the persisted `reactionEvent` (not ephemeral in-memory arrays).
 */
export function didActionExecute(event: Pick<ContextItem, "content">, actionName: string): boolean {
  const parts = (((event as any).content.parts ?? []) as any[]).flatMap((part) =>
    isContextPartEnvelope(part) ? [part] : normalizePartsForPersistence([part]),
  )
  return parts.some(
    (p) =>
      (p.type === "action" &&
        p.content.actionName === actionName &&
        (p.content.status === "completed" || p.content.status === "failed")) ||
      ((p as any).type === `tool-${actionName}` &&
        ((p as any).state === "output-available" || (p as any).state === "output-error")),
  )
}



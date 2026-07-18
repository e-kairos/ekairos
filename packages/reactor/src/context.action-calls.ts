import {
  normalizePartsForPersistence,
  type ContextPartEnvelope,
} from "@ekairos/events"

export type ReactionActionCall = Readonly<{
  actionCallId: string
  actionName: string
  input: unknown
}>

export function applyActionResult(
  parts: readonly ContextPartEnvelope[],
  call: ReactionActionCall,
  result:
    | Readonly<{ ok: true; output: unknown }>
    | Readonly<{ ok: false; error: string }>,
) {
  return normalizePartsForPersistence([
    ...parts,
    result.ok === true
      ? {
          type: "action",
          content: {
            status: "completed",
            actionName: call.actionName,
            actionCallId: call.actionCallId,
            output: result.output,
          },
        }
      : {
          type: "action",
          content: {
            status: "failed",
            actionName: call.actionName,
            actionCallId: call.actionCallId,
            error: { message: (result as Readonly<{ ok: false; error: string }>).error },
          },
        },
  ])
}

import { z } from "zod"

export const approvalOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("approved"),
    approved: z.literal(true),
    decidedBy: z.string().optional(),
    decidedAt: z.string().optional(),
    note: z.string().optional(),
  }),
  z.object({
    outcome: z.literal("rejected"),
    approved: z.literal(false),
    decidedBy: z.string().optional(),
    decidedAt: z.string().optional(),
    reason: z.string().min(1),
  }),
])

export type ApprovalOutcome = z.output<typeof approvalOutcomeSchema>
export type ApprovalCommand = "approve" | "reject"

export function approvalOutcomeForCommand(command: ApprovalCommand) {
  return command === "approve" ? "approved" : "rejected"
}

export function createApprovalOutcome(outcome: ApprovalOutcome) {
  return approvalOutcomeSchema.parse(outcome)
}

import type { ReactionContextHandle } from "@ekairos/context"
import type { ContextEvent } from "@ekairos/events"

import type { WorkbenchScenario } from "./domain"
import type { WorkbenchContext, WorkbenchRuntime } from "./runtime"

export type PreparedWorkbenchReaction = Readonly<{
  context: ReactionContextHandle<WorkbenchContext, WorkbenchRuntime>
  trigger: ContextEvent
  history: readonly ContextEvent[]
  scenario: WorkbenchScenario
  sandboxId?: string
  repositoryUrl?: string
}>

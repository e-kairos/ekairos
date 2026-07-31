import type { ContextEvent } from "@ekairos/events"

import type { WorkbenchScenario } from "./domain"
import type { WorkbenchRuntime } from "./runtime"

export type PreparedWorkbenchReaction = Readonly<{
  runtime: WorkbenchRuntime
  contextKey: string
  trigger: ContextEvent
  history: readonly ContextEvent[]
  scenario: WorkbenchScenario
  sandboxId?: string
  repositoryUrl?: string
}>

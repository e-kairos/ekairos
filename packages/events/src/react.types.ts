export type ContextStatus = "idle" | "running" | "failed"
export type SendStatus = "idle" | "submitting" | "error"
export type ReasoningLevel = "off" | "low" | "medium" | "high"

export const INPUT_TEXT_ITEM_TYPE = "user.message"
export const ASSISTANT_MESSAGE_TYPE = "assistant.message"

export type ContextEventPartForUI = {
  id: string
  key: string
  index: number
  type: string
  content: unknown
  metadata?: Record<string, unknown>
  createdAt: string | Date
  updatedAt?: string | Date
}

export type ContextEventForUI = {
  id: string
  type: string
  domain?: string
  name?: string
  channel?: string
  createdAt: string | Date
  payload: unknown
  links: Record<string, string | string[]>
  metadata: Record<string, unknown>
  eventParts: ContextEventPartForUI[]
}

export type ContextReactionForUI = {
  id: string
  type: string
  status: "running" | "completed" | "failed"
  position: number
  depth: number
  causeIds: string[]
  effectIds: string[]
  instruction?: string
  error?: unknown
  causes: ContextEventForUI[]
  effects: ContextEventForUI[]
  parent?: Pick<ContextReactionForUI, "id" | "type"> | null
}

export type ContextSessionForUI = {
  id: string
  definition: string
  status: "running" | "completed" | "failed"
  sandboxId?: string
  workflowRunId?: string
  error?: unknown
  createdAt: string | Date
  updatedAt?: string | Date
  trigger: ContextEventForUI | null
  rootReaction: ContextReactionForUI | null
  reactions: ContextReactionForUI[]
  children: ContextSessionForUI[]
}

export type AppendArgs = {
  parts: any[]
  webSearch?: boolean
  reasoningLevel?: ReasoningLevel
}

export type ContextFirstLevel = {
  id: string
  key?: string | null
  name?: string | null
  content?: unknown
  previous?: unknown
  currentSession: ContextSessionForUI | null
}

export type ContextValue = {
  apiUrl: string
  context: ContextFirstLevel | null
  contextId: string | null
  contextStatus: ContextStatus
  activeSessionId: string | null
  sessions: ContextSessionForUI[]
  reactions: ContextReactionForUI[]
  events: ContextEventForUI[]
  sendStatus: SendStatus
  sendError: string | null
  stop: () => void
  append: (args: AppendArgs) => Promise<void>
}

export type UseContextArgs = {
  contextId: string | null
  contextKey?: string
}

export type UseContextState = {
  context: any | null
}

export type UseContextStateHook = (
  db: any,
  args: UseContextArgs,
) => UseContextState

export type UseContextOptions = {
  apiUrl: string
  initialContextId?: string
  contextKey?: string
  onContextUpdate?: (contextId: string) => void
  prepareAppendArgs?: (args: AppendArgs) => Promise<AppendArgs> | AppendArgs
  prepareRequestBody?: (params: {
    messages: any[]
    webSearch?: boolean
    reasoningLevel?: ReasoningLevel
    contextId?: string
  }) => Promise<Record<string, unknown>> | Record<string, unknown>
  state?: UseContextStateHook
}

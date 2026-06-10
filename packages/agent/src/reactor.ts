import type { StoredContext } from "@ekairos/events";
import type { ThreadChunk } from "./transport.js";
import type { AgentItem } from "./items.js";

/**
 * Reactor params, shaped after ContextReactorParams from @ekairos/events so a
 * reactor written for a thread can graduate to the context engine untouched.
 * The thread runtime fills the subset it controls; engine-only fields are
 * added when the runtime delegates to ContextEngine.react.
 */
export type AgentReactionParams<Env extends Record<string, unknown> = Record<string, unknown>> = {
  env: Env;
  context: StoredContext<Record<string, unknown>>;
  triggerEvent: AgentItem;
  threadId: string;
  contextId: string;
  executionId: string;
  stepId: string;
  /** Pre-assigned id for the assistant item this reaction will produce. */
  eventId: string;
  iteration: number;
  emitChunk: (chunk: ThreadChunk) => void;
};

export type AgentReactionResult = {
  assistantEvent: AgentItem;
};

export type AgentReactor<Env extends Record<string, unknown> = Record<string, unknown>> = (
  params: AgentReactionParams<Env>,
) => Promise<AgentReactionResult>;

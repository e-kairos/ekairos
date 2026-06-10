import type { ChannelMessage } from "@ekairos/channel";
import type { AgentContextMeta, AgentItem } from "./items.js";

export type ThreadTurnStatus = "idle" | "streaming" | "error";

export type ThreadSendInput = {
  text: string;
};

/**
 * Normalized streaming chunk emitted while a reactor works. Reactors map
 * provider-specific events (codex app-server, AI SDK, ...) into this shape so
 * every transport and UI renders progress the same way.
 */
export type ThreadChunk =
  | { kind: "text-delta"; text: string }
  | { kind: "reasoning-delta"; text: string }
  | { kind: "activity"; label: string }
  | { kind: "raw"; data: unknown };

export type ThreadMeta = {
  id: string;
  key: string | null;
  title: string | null;
  status: string | null;
  createdAt: string;
  updatedAt: string | null;
  contextId: string;
};

/**
 * What a thread looks like over the wire: the thread, its context, the
 * context items, and the channel messages (email, whatsapp, ...) attached to
 * the same context.
 */
export type ThreadSnapshot = {
  thread: ThreadMeta;
  context: AgentContextMeta | null;
  items: AgentItem[];
  messages: ChannelMessage[];
};

export type ThreadTransportEvent =
  | { type: "item"; item: AgentItem }
  | { type: "message"; message: ChannelMessage }
  | { type: "status"; status: ThreadTurnStatus; error?: string }
  | { type: "chunk"; chunk: ThreadChunk };

/**
 * Transport contract between a thread UI and a thread runtime. Implemented
 * over Electron IPC (desktop), HTTP routes (web), or in-process (tests).
 */
export interface ThreadTransport {
  send(input: ThreadSendInput): Promise<void>;
  snapshot(): Promise<ThreadSnapshot>;
  subscribe(listener: (event: ThreadTransportEvent) => void): () => void;
}

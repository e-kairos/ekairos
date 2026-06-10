import type { Channel, ContextItem, ContextStatus } from "@ekairos/events";

export type AgentItem = ContextItem;
export type AgentItemChannel = Channel;

export type AgentContextMeta = {
  id: string;
  key: string | null;
  name?: string | null;
  status: ContextStatus;
  content: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AgentTextPart = { type: "text"; text: string };
export type AgentReasoningPart = { type: "reasoning"; text: string };

function generateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createTextInputItem(text: string, channel: AgentItemChannel = "web"): AgentItem {
  return {
    id: generateId(),
    type: "input",
    channel,
    createdAt: new Date().toISOString(),
    status: "completed",
    content: { parts: [{ type: "text", text }] },
  };
}

export function createAssistantItem(
  parts: unknown[],
  options?: { id?: string; channel?: AgentItemChannel },
): AgentItem {
  return {
    id: options?.id ?? generateId(),
    type: "output",
    channel: options?.channel ?? "web",
    createdAt: new Date().toISOString(),
    status: "completed",
    content: { parts },
  };
}

export function getItemText(item: AgentItem): string {
  const parts = Array.isArray(item.content?.parts) ? item.content.parts : [];
  return parts
    .filter((part): part is AgentTextPart => {
      return Boolean(part) && typeof part === "object" && (part as { type?: unknown }).type === "text";
    })
    .map((part) => part.text)
    .join("\n");
}

export function getItemReasoning(item: AgentItem): string {
  const parts = Array.isArray(item.content?.parts) ? item.content.parts : [];
  return parts
    .filter((part): part is AgentReasoningPart => {
      return Boolean(part) && typeof part === "object" && (part as { type?: unknown }).type === "reasoning";
    })
    .map((part) => part.text)
    .join("\n");
}

export { generateId as generateAgentId };

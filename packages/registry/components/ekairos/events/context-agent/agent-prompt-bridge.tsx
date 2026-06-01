"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/** Payload queued as a virtual attachment when a message artifact should become prompt context. */
export type ArtifactPromptAttachmentPayload = {
  actionCallId?: string;
  data: unknown;
  fileName?: string;
  instruction?: string;
  kind: string;
  mediaType?: string;
  metadata?: Record<string, unknown>;
  subtitle?: string;
  title: string;
};

export type ChartEditAttachmentPayload = {
  actionCallId?: string;
  title: string;
  subtitle?: string;
  points: Array<{ label: string; value: number }>;
};

type Listener = (payload: ArtifactPromptAttachmentPayload) => void;

export type AgentPromptBridgeValue = {
  emitArtifact: (payload: ArtifactPromptAttachmentPayload) => void;
  emitChartEdit: (payload: ChartEditAttachmentPayload) => void;
  subscribe: (fn: Listener) => () => void;
};

const AgentPromptBridgeContext = createContext<AgentPromptBridgeValue | null>(
  null,
);

export function AgentPromptBridgeProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const emitArtifact = useCallback((payload: ArtifactPromptAttachmentPayload) => {
    listeners.current.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error("AgentPromptBridge listener failed", e);
      }
    });
  }, []);

  const emitChartEdit = useCallback(
    (payload: ChartEditAttachmentPayload) =>
      emitArtifact({
        actionCallId: payload.actionCallId,
        data: { chart: payload },
        fileName: `${sanitizeFileName(`${payload.title || "chart"}-edit`)}.json`,
        instruction:
          "El usuario quiere editar este grafico. Genera una nueva version (misma herramienta / spec) segun el mensaje de texto que acompana.",
        kind: "chart-edit",
        metadata: { chart: payload },
        subtitle: payload.subtitle,
        title: `Editar grafico - ${payload.title}`,
      }),
    [emitArtifact],
  );

  const value = useMemo(
    () => ({ emitArtifact, emitChartEdit, subscribe }),
    [emitArtifact, emitChartEdit, subscribe],
  );

  return (
    <AgentPromptBridgeContext.Provider value={value}>
      {children}
    </AgentPromptBridgeContext.Provider>
  );
}

export function useAgentPromptBridge(): AgentPromptBridgeValue | null {
  return useContext(AgentPromptBridgeContext);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
}

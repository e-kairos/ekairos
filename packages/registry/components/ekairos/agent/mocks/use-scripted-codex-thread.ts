"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type {
  AppendArgs,
  ContextEventForUI,
  ThreadValue,
} from "@/components/ekairos/thread/context";
import { ASSISTANT_MESSAGE_TYPE, INPUT_TEXT_ITEM_TYPE } from "@/components/ekairos/thread/context";

import fixture from "./codex-run.fixture.json";

type FixtureStreamStep = {
  delayMs: number;
  phase: string;
  label: string;
  state: "output-streaming" | "output-available" | "output-error";
};

type FixtureData = {
  id: string;
  source: {
    runId: string;
    executionId: string;
    contextId: string;
    threadId: string;
  };
  request: {
    prompt: string;
    runtime: {
      mode: string;
      appServerUrl: string;
      approvalPolicy: string;
    };
  };
  stream: FixtureStreamStep[];
  reaction: {
    text: string;
    reasoning: string;
    status: string;
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeId(prefix: string): string {
  const maybeUuid = globalThis.crypto?.randomUUID?.();
  if (typeof maybeUuid === "string" && maybeUuid.length > 0) {
    return `${prefix}:${maybeUuid}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function extractPromptText(parts: any[]): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const rec = part as Record<string, unknown>;
      return typeof rec.text === "string" ? rec.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function createUserEvent(text: string): ContextEventForUI {
  return {
    id: makeId("user"),
    type: INPUT_TEXT_ITEM_TYPE,
    channel: "web",
    createdAt: nowIso(),
    status: "stored",
    content: {
      parts: [{ type: "text", text }],
    },
  };
}

function createCodexStreamEvent(params: {
  contextId: string;
  executionId: string;
  runId: string;
  step: FixtureStreamStep;
  index: number;
}): ContextEventForUI {
  const eventId = makeId(`codex-stream-${params.index}`);
  const payload = {
    phase: params.step.phase,
    label: params.step.label,
    eventId,
    stepId: null,
    detail: {
      contextId: params.contextId,
      executionId: params.executionId,
      runId: params.runId,
    },
    at: nowIso(),
  };

  return {
    id: eventId,
    type: ASSISTANT_MESSAGE_TYPE,
    channel: "web",
    createdAt: nowIso(),
    status: "stored",
    content: {
      parts: [
        {
          type: "codex-event",
          state: params.step.state,
          input: payload,
          output: payload,
          metadata: {
            source: "codex.stream.event",
            phase: params.step.phase,
            label: params.step.label,
            eventType: "codex-event",
            sequence: params.index,
          },
        },
      ],
    },
  };
}

function createReactionEvent(data: FixtureData): ContextEventForUI {
  return {
    id: makeId("reaction"),
    type: ASSISTANT_MESSAGE_TYPE,
    channel: "web",
    createdAt: nowIso(),
    status: data.reaction.status,
    content: {
      parts: [
        {
          type: "reasoning",
          text: data.reaction.reasoning,
        },
        {
          type: "text",
          text: data.reaction.text,
        },
        {
          type: "codex-event",
          state: "output-available",
          input: {
            phase: "turn.completed",
            label: "Turn completed",
          },
          output: {
            phase: "turn.completed",
            label: "Turn completed",
          },
          metadata: {
            source: "codex.stream.event",
            phase: "turn.completed",
            eventType: "codex-event",
          },
        },
      ],
    },
  };
}

export function useScriptedCodexThread(): ThreadValue & {
  reset: () => void;
  title: string;
} {
  const data = fixture as FixtureData;
  const [events, setEvents] = useState<ContextEventForUI[]>([]);
  const [contextStatus, setContextStatus] = useState<"open" | "streaming" | "closed">("open");
  const [sendStatus, setSendStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [turnSubstateKey, setTurnSubstateKey] = useState<string | null>(null);
  const currentRunRef = useRef(0);

  const stop = useCallback(() => {
    currentRunRef.current += 1;
    setContextStatus("open");
    setSendStatus("idle");
    setTurnSubstateKey(null);
  }, []);

  const reset = useCallback(() => {
    stop();
    setEvents([]);
    setSendError(null);
  }, [stop]);

  const append = useCallback(async (args: AppendArgs) => {
    if (sendStatus === "submitting") return;
    const promptText = extractPromptText(args.parts) || data.request.prompt;

    const runToken = currentRunRef.current + 1;
    currentRunRef.current = runToken;

    setSendError(null);
    setSendStatus("submitting");
    setContextStatus("streaming");
    setTurnSubstateKey("code.runtime.connecting");
    setEvents((prev) => [...prev, createUserEvent(promptText)]);

    try {
      for (let index = 0; index < data.stream.length; index += 1) {
        const step = data.stream[index];
        await wait(step.delayMs);
        if (currentRunRef.current !== runToken) return;

        setTurnSubstateKey(
          step.phase === "runtime.connecting" ? "code.runtime.connecting" : "code.runtime.ready",
        );
        setEvents((prev) => [
          ...prev,
          createCodexStreamEvent({
            contextId: data.source.contextId,
            executionId: data.source.executionId,
            runId: data.source.runId,
            step,
            index,
          }),
        ]);
      }

      if (currentRunRef.current !== runToken) return;
      setEvents((prev) => [...prev, createReactionEvent(data)]);
      setContextStatus("open");
      setSendStatus("idle");
      setTurnSubstateKey(null);
    } catch (error) {
      if (currentRunRef.current !== runToken) return;
      setSendStatus("error");
      setContextStatus("open");
      setTurnSubstateKey(null);
      setSendError(error instanceof Error ? error.message : String(error));
    }
  }, [data, sendStatus]);

  const thread = useMemo<ThreadValue & { reset: () => void; title: string }>(
    () => ({
      apiUrl: "/api/code/agent",
      contextId: data.source.contextId,
      contextStatus,
      turnSubstateKey,
      events,
      sendStatus,
      sendError,
      stop,
      append,
      reset,
      title: data.title,
    }),
    [append, contextStatus, data.source.contextId, data.title, events, reset, sendError, sendStatus, stop, turnSubstateKey],
  );

  return thread;
}

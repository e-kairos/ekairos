"use client";

import { useEffect, useRef, useState } from "react";
import { INPUT_TEXT_ITEM_TYPE, type ContextValue } from "@ekairos/events/react";
import { DotmSquare10 } from "@/components/ui/dotm-square-10";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MatrixPattern } from "@/lib/dotmatrix-core";
import { cn } from "@/lib/utils";
import {
  getActionPartInfo,
  getPartText,
  getReasoningText,
} from "../context-event-parts";

type ContextActivityTone = "neutral" | "info" | "warning" | "error";
type ContextActivityPhase = "idle" | "live" | "finishing" | "error";

export type ContextActivityState = {
  label: string;
  title?: string;
  animated?: boolean;
  pattern: MatrixPattern;
  phase?: ContextActivityPhase;
  speed: number;
  tone?: ContextActivityTone;
};

const FINISHING_ANIMATION_MS = 1550;
const IDLE_AFTER_FINISH_MS = 850;
const ACTIVITY_FADE_OUT_MS = 320;

const IDLE_CONTEXT_ACTIVITY: ContextActivityState = {
  label: "Listo",
  animated: true,
  pattern: "outline",
  phase: "idle",
  speed: 1,
  tone: "neutral",
};

const FINISHING_CONTEXT_ACTIVITY: ContextActivityState = {
  label: "Finalizando",
  animated: true,
  pattern: "diamond",
  phase: "finishing",
  speed: 1.4,
  tone: "info",
};

function shouldPlayTerminalFinishing(
  activity: ContextActivityState | null,
): activity is ContextActivityState {
  if (!activity) return false;
  const phase = activity.phase ?? (activity.tone === "error" ? "error" : "live");
  return phase === "live";
}

function isUserEventType(type: unknown): boolean {
  const value = String(type ?? "");
  return (
    value === INPUT_TEXT_ITEM_TYPE ||
    value === "input" ||
    value.startsWith("user.")
  );
}

function latestAssistantEvent(context: ContextValue) {
  for (let i = context.events.length - 1; i >= 0; i -= 1) {
    const event = context.events[i];
    if (!isUserEventType(event?.type)) return event;
  }
  return null;
}

function latestRunningStep(context: ContextValue) {
  const assistant = latestAssistantEvent(context);
  const steps = Array.isArray(assistant?.steps) ? assistant.steps : [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step?.status === "running") return step;
  }
  return null;
}

function latestStartedActionName(parts: Array<Record<string, unknown>>) {
  const terminalActionIds = new Set<string>();
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const action = getActionPartInfo(parts[i]);
    if (!action) continue;
    if (action.status === "completed" || action.status === "failed") {
      terminalActionIds.add(action.actionCallId);
      continue;
    }
    if (
      action.status === "started" &&
      !terminalActionIds.has(action.actionCallId)
    ) {
      return action.actionName;
    }
  }
  return "";
}

function humanizeActionName(actionName: string): string {
  return actionName
    .replace(/Tool$/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function hasReasoning(parts: Array<Record<string, unknown>>) {
  return parts.some((part) => {
    if (part?.type !== "reasoning") return false;
    return getReasoningText(part).trim().length > 0;
  });
}

function hasAssistantText(parts: Array<Record<string, unknown>>) {
  return parts.some((part) => getPartText(part).trim().length > 0);
}

export function getContextActivityState({
  context,
  isUploading = false,
}: {
  context: ContextValue;
  isUploading?: boolean;
}): ContextActivityState | null {
  const contextStatus = context.contextStatus;
  const executionStatus = context.context?.currentExecution?.status;
  const assistant = latestAssistantEvent(context);
  const runningStep = latestRunningStep(context);
  const assistantPending = assistant?.status === "pending";

  if (isUploading) {
    return {
      label: "Subiendo",
      animated: true,
      pattern: "outline",
      speed: 2.2,
      tone: "info",
    };
  }

  if (context.sendStatus === "error") {
    return {
      label: "No se envio",
      title: context.sendError ?? "Revisa la conexion e intenta de nuevo.",
      animated: false,
      pattern: "cross",
      speed: 1,
      tone: "error",
    };
  }

  if (context.sendStatus === "submitting" && contextStatus !== "open_streaming") {
    return {
      label: "Enviando",
      animated: true,
      pattern: "full",
      speed: 3,
      tone: "info",
    };
  }

  if (executionStatus === "failed" && assistantPending) {
    return {
      label: "Error",
      title: "El ultimo turno termino con error.",
      animated: false,
      pattern: "cross",
      speed: 1,
      tone: "error",
    };
  }

  if (contextStatus !== "open_streaming") return null;

  if (executionStatus === "executing" && !assistant) {
    return {
      label: "Iniciando",
      animated: true,
      pattern: "outline",
      speed: 1.4,
      tone: "info",
    };
  }

  if (!runningStep) {
    return {
      label: "Preparando",
      animated: true,
      pattern: "diamond",
      speed: 1.7,
      tone: "info",
    };
  }

  const parts = Array.isArray(runningStep.parts) ? runningStep.parts : [];
  const actionName = latestStartedActionName(parts);
  if (actionName) {
    return {
      label: "Trabajando",
      title: humanizeActionName(actionName),
      animated: true,
      pattern: "full",
      speed: 3.2,
      tone: "warning",
    };
  }

  if (hasReasoning(parts)) {
    return {
      label: "Pensando",
      animated: true,
      pattern: "rings",
      speed: 1.25,
      tone: "info",
    };
  }

  if (hasAssistantText(parts)) {
    return {
      label: "Respondiendo",
      animated: true,
      pattern: "full",
      speed: 2.4,
      tone: "info",
    };
  }

  return {
    label: "Preparando",
    animated: true,
    pattern: "diamond",
    speed: 1.6,
    tone: "neutral",
  };
}

export function ContextActivityIndicator({
  activity,
  density = "default",
}: {
  activity: ContextActivityState | null;
  density?: "default" | "compact";
}) {
  const [displayActivity, setDisplayActivity] =
    useState<ContextActivityState | null>(activity);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [loaderVersion, setLoaderVersion] = useState(0);
  const lastLiveActivityRef = useRef<ContextActivityState | null>(
    shouldPlayTerminalFinishing(activity) ? activity : null,
  );

  useEffect(() => {
    if (activity) {
      lastLiveActivityRef.current = shouldPlayTerminalFinishing(activity)
        ? activity
        : null;
      setIsFadingOut(false);
      setDisplayActivity(activity);
      return;
    }

    const previousActivity = lastLiveActivityRef.current;
    lastLiveActivityRef.current = null;

    if (shouldPlayTerminalFinishing(previousActivity)) {
      setIsFadingOut(false);
      setDisplayActivity(FINISHING_CONTEXT_ACTIVITY);
      setLoaderVersion((current) => current + 1);

      let idleTimeoutId: number | undefined;
      let fadeTimeoutId: number | undefined;
      const finishingTimeoutId = window.setTimeout(() => {
        setDisplayActivity(IDLE_CONTEXT_ACTIVITY);
        setLoaderVersion((current) => current + 1);
        idleTimeoutId = window.setTimeout(() => {
          setIsFadingOut(true);
          fadeTimeoutId = window.setTimeout(() => {
            setDisplayActivity(null);
            setIsFadingOut(false);
          }, ACTIVITY_FADE_OUT_MS);
        }, IDLE_AFTER_FINISH_MS);
      }, FINISHING_ANIMATION_MS);

      return () => {
        window.clearTimeout(finishingTimeoutId);
        if (idleTimeoutId !== undefined) {
          window.clearTimeout(idleTimeoutId);
        }
        if (fadeTimeoutId !== undefined) {
          window.clearTimeout(fadeTimeoutId);
        }
      };
    }

    setIsFadingOut(false);
    setDisplayActivity(null);
  }, [activity]);

  if (!displayActivity) return null;

  const toneClassName =
    displayActivity.tone === "error"
      ? "text-destructive"
      : displayActivity.tone === "warning"
        ? "text-amber-700 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div
      className={cn(
        "mx-auto mb-1.5 flex w-full max-w-3xl justify-start px-1 transition-[opacity,transform] duration-300 ease-out",
        density === "compact" && "max-w-none",
        isFadingOut && "-translate-x-3 opacity-0",
      )}
    >
      <TooltipProvider delayDuration={260}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              data-testid="context-activity-indicator"
              className={cn(
                "inline-flex h-5 items-center transition-colors",
                toneClassName,
              )}
            >
              <DotmSquare10
                key={loaderVersion}
                ariaLabel={displayActivity.label}
                animated={displayActivity.animated ?? true}
                pattern={displayActivity.pattern}
                speed={displayActivity.speed}
                size={density === "compact" ? 16 : 18}
                dotSize={2}
                cellPadding={density === "compact" ? 1.5 : 2}
                opacityBase={displayActivity.tone === "error" ? 0.2 : 0.1}
                opacityMid={displayActivity.tone === "error" ? 0.42 : 0.34}
                opacityPeak={displayActivity.tone === "error" ? 0.9 : 0.82}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {displayActivity.title ?? displayActivity.label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

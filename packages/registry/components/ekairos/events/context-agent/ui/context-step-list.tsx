"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

import type { ContextStepForUI } from "@ekairos/events/react";
import type { AgentClassNames } from "../types";
import {
  getActionPartInfo,
  getPartText,
  normalizeContextEventParts,
} from "../context-event-parts";
import { MessageParts } from "./message-parts";

type ContextStepListProps = {
  steps?: ContextStepForUI[];
  actionComponents?: Record<string, any>;
  classNames?: AgentClassNames;
  showReasoning?: boolean;
  showDebug?: boolean;
  className?: string;
};

function stepHookDebugProjection(step: ContextStepForUI) {
  return {
    step: {
      stepId: step.stepId,
      executionId: step.executionId,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
      status: step.status,
      iteration: step.iteration,
    },
    parts: step.parts,
  };
}

function StepHookDebug({ step }: { step: ContextStepForUI }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer list-none text-[11px] text-muted-foreground">
        hook debug
      </summary>
      <pre
        data-testid="context-step-debug"
        className="mt-2 max-h-80 overflow-auto rounded border bg-muted/30 p-3 text-[11px] leading-4 text-muted-foreground"
      >
        {JSON.stringify(stepHookDebugProjection(step), null, 2)}
      </pre>
    </details>
  );
}

function StepBody({
  step,
  actionComponents,
  classNames,
  showReasoning,
  showDebug,
}: {
  step: ContextStepForUI;
  actionComponents: Record<string, any>;
  classNames?: AgentClassNames;
  showReasoning: boolean;
  showDebug: boolean;
}) {
  const hasParts = step.parts.length > 0;
  if (!hasParts && !showDebug) return null;

  const isLive = step.status === "running";

  return (
    <div className="space-y-1.5">
      {hasParts ? (
        <MessageParts
          message={{
            id: `context-step:${step.stepId}`,
            role: "assistant",
            parts: step.parts,
            metadata: {
              stepId: step.stepId,
              executionId: step.executionId,
              status: step.status,
            },
          }}
          status={isLive ? "streaming" : "ready"}
          isLatest={isLive}
          actionComponents={actionComponents}
          classNames={classNames}
          showReasoning={showReasoning}
          surface="step"
        />
      ) : null}
      {showDebug ? <StepHookDebug step={step} /> : null}
    </div>
  );
}

function StepFrame({
  children,
  step,
}: {
  children: ReactNode;
  step: ContextStepForUI;
}) {
  const status = String(step.status ?? "unknown");
  const summary = summarizeStep(step);

  return (
    <div
      data-status={status}
      data-testid="context-step-frame"
      className={cn(
        "min-w-0 border-l border-border/70 pl-3",
        status === "running" && "border-cyan-400/70",
        status === "failed" && "border-destructive/70",
      )}
    >
      <div className="mb-1.5 grid min-h-5 grid-cols-[9px_minmax(0,auto)_minmax(0,1fr)] items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "size-[7px] rounded-full bg-muted-foreground/60 shadow-[0_0_10px_rgba(34,211,238,0.16)]",
            status === "running" && "animate-pulse bg-cyan-300",
            status === "failed" && "bg-destructive",
          )}
        />
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase text-foreground/80">
          {summary.title}
        </span>
        <span className="min-w-0 truncate text-[10px] font-medium text-muted-foreground">
          {summary.detail}
        </span>
      </div>
      {children}
    </div>
  );
}

function summarizeStep(step: ContextStepForUI) {
  const parts = normalizeContextEventParts(
    Array.isArray(step.parts) ? step.parts : [],
  );
  const firstAction = parts.map((part) => getActionPartInfo(part)).find(Boolean);
  const firstText = parts.map((part) => getPartText(part).trim()).find(Boolean);
  const title = firstAction
    ? humanizeActionName(firstAction.actionName)
    : "event_step";
  const detail = [
    String(step.status ?? "unknown"),
    typeof step.iteration === "number" ? `iteration ${step.iteration}` : "",
    firstText ? trimText(firstText, 56) : "",
  ]
    .filter(Boolean)
    .join(" / ");

  return { detail, title };
}

function trimText(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}...`;
}

function humanizeActionName(value: string): string {
  return value
    .replace(/Tool$/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function ContextStepList({
  steps = [],
  actionComponents = {},
  classNames,
  showReasoning = true,
  showDebug = false,
  className,
}: ContextStepListProps) {
  const renderableSteps = steps.filter(
    (step) => step.parts.length > 0 || showDebug,
  );

  if (renderableSteps.length === 0) return null;

  return (
    <div className={cn("mt-3 space-y-2", className)}>
      {renderableSteps.map((step) => (
        <StepFrame key={step.stepId} step={step}>
          <div data-testid="context-step" className="min-w-0">
            <StepBody
              step={step}
              actionComponents={actionComponents}
              classNames={classNames}
              showReasoning={showReasoning}
              showDebug={showDebug}
            />
          </div>
        </StepFrame>
      ))}
    </div>
  );
}

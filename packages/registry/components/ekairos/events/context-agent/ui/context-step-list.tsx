"use client";

import { cn } from "@/lib/utils";

import type { ContextStepForUI } from "@ekairos/events/react";
import type { AgentClassNames } from "../types";
import {
  getActionPartInfo,
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

function normalizedStepParts(step: ContextStepForUI) {
  return normalizeContextEventParts(Array.isArray(step.parts) ? step.parts : []);
}

function countStepActions(step: ContextStepForUI) {
  const actionCallIds = new Set<string>();
  for (const part of normalizedStepParts(step)) {
    const action = getActionPartInfo(part);
    if (action?.actionCallId) {
      actionCallIds.add(action.actionCallId);
    }
  }
  return actionCallIds.size;
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

  const runningStepCount = renderableSteps.filter(
    (step) => step.status === "running",
  ).length;

  return (
    <div
      className={cn("mt-3 space-y-2", className)}
      data-context-step-list
      data-debug-enabled={showDebug ? "true" : "false"}
      data-running-step-count={runningStepCount}
      data-show-reasoning={showReasoning ? "true" : "false"}
      data-step-count={renderableSteps.length}
    >
      {renderableSteps.map((step) => {
        const normalizedParts = normalizedStepParts(step);
        return (
          <div
            className="min-w-0"
            data-context-step
            data-step-action-count={countStepActions(step)}
            data-step-has-debug={showDebug ? "true" : "false"}
            data-step-live={step.status === "running" ? "true" : "false"}
            data-step-part-count={normalizedParts.length}
            data-step-status={String(step.status ?? "unknown")}
            data-testid="context-step"
            key={step.stepId}
          >
            <StepBody
              actionComponents={actionComponents}
              classNames={classNames}
              showDebug={showDebug}
              showReasoning={showReasoning}
              step={step}
            />
          </div>
        );
      })}
    </div>
  );
}

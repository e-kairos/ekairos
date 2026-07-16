import {
  runReactionWorkflow,
  type ReactionDefinition,
  type ReactionWorkflowPayload,
} from "@ekairos/reactor";
import {
  storySmoke,
  storySmokeScripted,
  storySmokeToolError,
} from "./story-smoke.story";
import { getWorkflowMetadata } from "workflow";

type SmokeEnv = { mode: "success" | "tool-error" | "scripted" };

function roundMs(value: number) {
  return Math.max(0, Math.round(value));
}

function createStageTimer() {
  const startedAt = Date.now();
  const stageTimingsMs: Record<string, number> = {};
  let currentStage: string | undefined;

  return {
    async measure<T>(name: string, run: () => Promise<T> | T): Promise<T> {
      const previousStage = currentStage;
      currentStage = name;
      const stageStartedAt = Date.now();
      try {
        return await run();
      } finally {
        stageTimingsMs[name] = roundMs(Date.now() - stageStartedAt);
        currentStage = previousStage;
      }
    },
    add(name: string, value: number) {
      stageTimingsMs[name] = roundMs((stageTimingsMs[name] ?? 0) + value);
    },
    getCurrentStage() {
      return currentStage;
    },
    snapshot() {
      return {
        totalMs: roundMs(Date.now() - startedAt),
        stageTimingsMs: { ...stageTimingsMs },
      };
    },
  };
}

export async function contextEngineDurableWorkflow(
  payload: ReactionWorkflowPayload,
) {
  "use workflow";

  const reactor =
    payload.reactionKey === "story.smoke.scripted"
      ? storySmokeScripted
      : payload.reactionKey === "story.smoke.tool-error"
        ? storySmokeToolError
        : payload.reactionKey === "story.smoke"
          ? storySmoke
          : null;

  if (!reactor) {
    throw new Error(`Unknown reaction key "${payload.reactionKey}" for durable workflow`);
  }

  const benchmark = createStageTimer();
  const catalog = [storySmoke, storySmokeScripted, storySmokeToolError] as unknown as
    readonly ReactionDefinition[];
  const result = await runReactionWorkflow(payload, catalog);
  // eslint-disable-next-line no-console
  console.log(
    `[context-workflow-benchmark] ${JSON.stringify({
      workflowRunId: String(getWorkflowMetadata()?.workflowRunId ?? ""),
      reactionKey: payload.reactionKey,
      sessionId: payload.sessionId,
      ...benchmark.snapshot(),
    })}`,
  );
  return result;
}

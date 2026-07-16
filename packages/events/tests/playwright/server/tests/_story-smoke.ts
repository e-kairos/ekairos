import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { init } from "@instantdb/admin";
import { domain } from "@ekairos/domain";
import { contextDomain } from "@ekairos/events";
import { config as dotenvConfig } from "dotenv";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const smokeDir = resolve(dirname(currentFile), "..");
const repoRoot = resolve(smokeDir, "..", "..", "..", "..", "..");

dotenvConfig({ path: resolve(smokeDir, ".env.local"), quiet: true });
dotenvConfig({ path: resolve(smokeDir, ".env"), quiet: true });
dotenvConfig({ path: resolve(repoRoot, ".env.local"), quiet: true });
dotenvConfig({ path: resolve(repoRoot, ".env"), quiet: true });

type SmokeMode = "success" | "tool-error" | "scripted";

function instantEnv() {
  const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID
    || process.env.INSTANT_APP_ID
    || process.env.INSTANTDB_APP_ID;
  const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN
    || process.env.INSTANT_ADMIN_TOKEN
    || process.env.INSTANTDB_ADMIN_TOKEN;
  if (!appId || !adminToken) throw new Error("Instant env not configured for workflow smoke.");
  return { appId, adminToken };
}

function adminDb() {
  const appDomain = domain("story-workflow-smoke-test")
    .includes(contextDomain)
    .withSchema({ entities: {}, links: {}, rooms: {} });
  return init({
    ...instantEnv(),
    schema: appDomain.instantSchema(),
    useDateObjects: true,
  } as any);
}

function one(value: unknown): any {
  return Array.isArray(value) ? value[0] : value;
}

function workflowArtifacts(runId: string) {
  const root = resolve(smokeDir, ".next", "workflow-data");
  return ["runs", "events", "steps"].flatMap(kind => {
    const directory = resolve(root, kind);
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter(file => file.startsWith(runId) && file.endsWith(".json"))
      .map(file => `${kind}/${file}`);
  });
}

async function waitForWorkflowArtifacts(runId: string) {
  const deadline = Date.now() + 5_000;
  let files: string[] = [];
  while (Date.now() < deadline && files.length === 0) {
    files = workflowArtifacts(runId);
    if (files.length === 0) await new Promise(resolve => setTimeout(resolve, 500));
  }
  return files;
}

export async function verifyStorySmoke(
  request: APIRequestContext,
  mode: SmokeMode,
) {
  const startedAt = Date.now();
  const response = await request.post(`/api/internal/workflow/story-smoke?mode=${mode}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);

  const contextId = String(body.data.context.id);
  const triggerId = String(body.data.trigger.id);
  const effectId = String(body.data.effect.id);
  const expected = mode === "tool-error"
    ? { ok: false, message: "echo_failed" }
    : { ok: true, message: "ping" };
  expect(body.data.effect.payload).toEqual(expected);

  const result = await adminDb().query({
    context_sessions: {
      $: {
        where: { "context.id": contextId },
        order: { createdAt: "desc" },
        limit: 1,
      },
      trigger: { eventParts: {} },
      rootReaction: { causes: {}, effects: { eventParts: {} } },
      reactions: {
        $: { order: { position: "asc" }, limit: 20 },
        causes: {},
        effects: { eventParts: {} },
      },
    },
  } as any);
  const session: any = (result as any).context_sessions?.[0];
  expect(session?.status).toBe("completed");
  expect(session?.workflowRunId).toBeTruthy();
  expect(one(session?.trigger)?.id).toBe(triggerId);
  expect(one(session?.rootReaction)?.effects?.map((event: any) => event.id)).toContain(effectId);

  const agent = session.reactions.find((reaction: any) => reaction.type === "agent");
  expect(agent?.status).toBe("completed");
  expect(agent?.causes?.map((event: any) => event.id)).toEqual([triggerId]);
  expect(agent?.effects).toHaveLength(1);
  expect(agent.effects[0].payload).toEqual(expected);
  expect(agent.effects[0].eventParts).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "message" }),
  ]));

  const files = await waitForWorkflowArtifacts(session.workflowRunId);
  expect(files.length).toBeGreaterThan(0);
  expect(files).toContain(`runs/${session.workflowRunId}.json`);
  expect(files.some(file => file.startsWith("events/"))).toBe(true);
  expect(files.some(file => file.startsWith("steps/"))).toBe(true);
  return {
    mode,
    contextId,
    sessionId: session.id,
    workflowRunId: session.workflowRunId,
    triggerId,
    effectId,
    reactionTypes: session.reactions.map((reaction: any) => reaction.type),
    workflowArtifacts: files,
    durationMs: Date.now() - startedAt,
  };
}

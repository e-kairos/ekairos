"use client";

import * as React from "react";

import { useRegistrySession, type RegistrySession } from "@/lib/registry-session";

export type DemoStepState = "pending" | "active" | "done" | "error";

export type DemoSteps = {
  database: DemoStepState;
  schema: DemoStepState;
  data: DemoStepState;
};

export type DemoExperience = {
  steps: DemoSteps;
  session: RegistrySession | null;
  contextId: string | null;
  ready: boolean;
  error: string | null;
  retry: () => void;
  reseed: () => Promise<void>;
};

const ensuredDomains = new Set<string>();
const seedContextCache = new Map<string, string>();

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `demo_request_failed:${url}`);
  }
  return payload.data as T;
}

/**
 * The site-wide demo lifecycle, as one hook:
 *   database (temporary InstantDB app) → domain schema → page demo data.
 * Steps report state for the shared provisioning HUD; results are cached so
 * navigating around a domain never re-provisions.
 */
export function useDemoExperience(params: { domainId: string; seedId?: string }): DemoExperience {
  const { domainId, seedId } = params;
  const { ensureSession } = useRegistrySession();

  const [session, setSession] = React.useState<RegistrySession | null>(null);
  const [steps, setSteps] = React.useState<DemoSteps>({
    database: "active",
    schema: "pending",
    data: seedId ? "pending" : "done",
  });
  const [contextId, setContextId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setError(null);
      setSteps({ database: "active", schema: "pending", data: seedId ? "pending" : "done" });

      try {
        const current = await ensureSession();
        if (cancelled) return;
        setSession(current);
        setSteps((prev) => ({ ...prev, database: "done", schema: "active" }));

        const domainKey = `${current.appId}:${domainId}`;
        if (!ensuredDomains.has(domainKey)) {
          await postJson("/api/demo/domain", { appId: current.appId, domainId });
          ensuredDomains.add(domainKey);
        }
        if (cancelled) return;
        setSteps((prev) => ({ ...prev, schema: "done", data: seedId ? "active" : "done" }));

        if (seedId) {
          const seedKey = `${current.appId}:${seedId}`;
          let seededContextId = seedContextCache.get(seedKey) ?? null;
          if (!seededContextId) {
            const result = await postJson<{ contextId: string }>("/api/demo/seed", {
              appId: current.appId,
              adminToken: current.adminToken,
              seedId,
            });
            seededContextId = result.contextId;
            seedContextCache.set(seedKey, seededContextId);
          }
          if (cancelled) return;
          setContextId(seededContextId);
          setSteps((prev) => ({ ...prev, data: "done" }));
        }
      } catch (runError) {
        if (cancelled) return;
        const message = runError instanceof Error ? runError.message : String(runError);
        setError(message);
        setSteps((prev) => {
          if (prev.database !== "done") return { ...prev, database: "error" };
          if (prev.schema !== "done") return { ...prev, schema: "error" };
          return { ...prev, data: "error" };
        });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [domainId, seedId, ensureSession, attempt]);

  const reseed = React.useCallback(async () => {
    if (!session || !seedId) return;
    const result = await postJson<{ contextId: string }>("/api/demo/seed", {
      appId: session.appId,
      adminToken: session.adminToken,
      seedId,
      reset: true,
    });
    seedContextCache.set(`${session.appId}:${seedId}`, result.contextId);
    setContextId(result.contextId);
  }, [session, seedId]);

  return {
    steps,
    session,
    contextId,
    ready: steps.database === "done" && steps.schema === "done" && steps.data === "done",
    error,
    retry: () => setAttempt((current) => current + 1),
    reseed,
  };
}

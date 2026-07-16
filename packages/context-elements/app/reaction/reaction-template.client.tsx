"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useContext } from "@ekairos/events/react";

import { getPreviewDb } from "@/lib/client-db";

type RuntimeState = {
  appId: string;
  contextId: string;
  loading: boolean;
  error: string | null;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function LiveReaction({ appId, contextId }: { appId: string; contextId: string }) {
  const contextKey = "reaction-template";
  const db = useMemo(() => getPreviewDb(appId), [appId]);
  const context = useContext(db, {
    apiUrl: `/api/context/${contextKey}`,
    contextKey,
    initialContextId: contextId,
  });

  const run = useCallback(async () => {
    await context.append({
      parts: [
        {
          type: "text",
          text: "Resume el pedido y decide el siguiente paso.",
        },
      ],
    });
  }, [context]);

  return (
    <section className="card section">
      <div className="section-head">
        <div>
          <h2 className="section-title">Reaction runtime</h2>
          <p className="section-desc">
            The client reads durable sessions, reactions, events, and event parts.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className="pill">{context.contextStatus}</span>
          <span className="pill">{context.events.length} events</span>
          <span className="pill">{context.activeSessionId ? "active session" : "synced"}</span>
        </div>
      </div>

      <button
        className="btn"
        type="button"
        onClick={() => void run()}
        disabled={context.sendStatus === "submitting"}
        style={{ cursor: context.sendStatus === "submitting" ? "wait" : "pointer" }}
      >
        {context.sendStatus === "submitting" ? "Running reaction..." : "Run reaction"}
      </button>

      {context.sendError ? (
        <div className="context-strip" style={{ marginTop: 12 }}>
          <h3>Reaction error</h3>
          <p>{context.sendError}</p>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {context.events.map((event) => (
          <article className="element-card" key={event.id}>
            <div className="meta-row">
              <span>{event.type}</span>
              <span>{event.eventParts.length} parts</span>
            </div>
            <h3 style={{ margin: "4px 0 8px" }}>
              {asText((event as Record<string, unknown>).name) ||
                asText((event as Record<string, unknown>).kind) ||
                "Context event"}
            </h3>
            <pre className="cmd">{JSON.stringify(event.payload, null, 2)}</pre>
            {event.eventParts.length ? (
              <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                {event.eventParts.map((part) => (
                  <div className="meta-row" key={part.id}>
                    <span>{part.type}</span>
                    <span>#{part.index}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <details style={{ marginTop: 16 }}>
        <summary>Context and reaction JSON</summary>
        <pre className="cmd" style={{ marginTop: 8 }}>
          {JSON.stringify(
            {
              context: context.context,
              activeSessionId: context.activeSessionId,
              reactions: context.reactions,
              events: context.events,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}

export function ReactionTemplateClient() {
  const [runtime, setRuntime] = useState<RuntimeState>({
    appId: "",
    contextId: "",
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    void fetch("/api/context/reaction-template?ensure=1")
      .then(async (response) => {
        const body = (await response.json()) as Record<string, unknown>;
        if (!response.ok) throw new Error(asText(body.error) || `Bootstrap failed (${response.status}).`);
        if (!active) return;
        setRuntime({
          appId: asText(body.appId),
          contextId: asText(body.contextId),
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRuntime({
          appId: "",
          contextId: "",
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      active = false;
    };
  }, []);

  if (runtime.loading) {
    return <div className="context-strip">Provisioning a temporary InstantDB app...</div>;
  }
  if (runtime.error) {
    return (
      <div className="context-strip">
        <h3>Template error</h3>
        <p>{runtime.error}</p>
      </div>
    );
  }
  if (!runtime.appId || !runtime.contextId) return null;
  return <LiveReaction appId={runtime.appId} contextId={runtime.contextId} />;
}

"use client";

import React, { useMemo, useState } from "react";
import type { RegistryItem } from "@/lib/registry-types";

type ContextStreamChunk = {
  type: string;
  data?: Record<string, unknown>;
  id?: string;
};

function UseContextDemo() {
  const [contextId, setContextId] = useState<string | null>("ctx_demo_01");
  const [eventCount, setEventCount] = useState(2);
  const [isStreaming, setIsStreaming] = useState(false);

  const applyChunk = (chunk: ContextStreamChunk) => {
    if (chunk.type === "data-context-id") {
      const payload = (chunk.data ?? {}) as { contextId?: unknown };
      const nextId =
        typeof payload.contextId === "string"
          ? payload.contextId
          : typeof chunk.id === "string"
            ? chunk.id
            : null;
      setContextId(nextId);
      return;
    }

    if (chunk.type === "data-context-substate") {
      const payload = (chunk.data ?? {}) as { key?: unknown };
      const nextKey = typeof payload.key === "string" ? payload.key : null;
      setIsStreaming(nextKey === "actions");
      return;
    }

    setEventCount((count) => count + 1);
  };

  const statusLabel = useMemo(() => (isStreaming ? "streaming" : "idle"), [isStreaming]);

  return (
    <div className="w-full max-w-xl border border-border bg-background p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        useContext state
      </p>
      <div className="mt-4 grid gap-2 font-mono text-xs">
        <div>contextId: {contextId ?? "null"}</div>
        <div>contextStatus: {statusLabel}</div>
        <div>events: {eventCount}</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted/50"
          onClick={() =>
            applyChunk({
              type: "data-context-id",
              data: { contextId: `ctx_demo_${Math.floor(Math.random() * 100)}` },
            })
          }
        >
          new context id
        </button>
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted/50"
          onClick={() =>
            applyChunk({
              type: "data-context-substate",
              data: { key: "actions" },
            })
          }
        >
          streaming
        </button>
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted/50"
          onClick={() =>
            applyChunk({
              type: "data-context-substate",
              data: { key: null },
            })
          }
        >
          idle
        </button>
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted/50"
          onClick={() => applyChunk({ type: "data-context-event" })}
        >
          append event
        </button>
      </div>
    </div>
  );
}

export const useContextRegistryItem: RegistryItem = {
  id: "use-context",
  registryName: "use-context",
  title: "useContext hook",
  subtitle:
    "Canonical client hook from @ekairos/events/react for context identity, status, events, and append.",
  category: "core",
  props: [
    {
      name: "contextKey",
      type: "string",
      default: "required",
      description: "Durable context key used by the GET endpoint.",
    },
    {
      name: "orgId",
      type: "string",
      default: "-",
      description: "Tenant/runtime org id forwarded to the context endpoint.",
    },
    {
      name: "apiUrl",
      type: "string",
      default: "'/api/events/context'",
      description: "Endpoint used by the hook for snapshots and append calls.",
    },
    {
      name: "ensure",
      type: "boolean",
      default: "false",
      description: "When true, endpoint can ensure context existence before read.",
    },
  ],
  code: `"use client"

import { useContext } from "@ekairos/events/react"
import { useOrgDb } from "@/lib/org-db-context"

export function ContextStatePanel() {
  const { db } = useOrgDb()
  const {
    contextId,
    contextStatus,
    events,
  } = useContext(db, {
    apiUrl: "/api/events/context",
    contextKey: "support.agent.session.42",
  })

  return (
    <div>
      <p>contextId: {contextId}</p>
      <p>status: {contextStatus}</p>
      <p>events: {events.length}</p>
    </div>
  )
}
`,
  render: () => <UseContextDemo />,
};

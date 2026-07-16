"use client";

import React, { useMemo } from "react";

import { EventContextPanel } from "@/components/ekairos/events/event-context-panel";
import type { RegistryItem } from "@/lib/registry-types";

const initialEvents = [
  {
    id: "evt-user-01",
    type: "user.message",
    channel: "web",
    createdAt: "2026-05-22T12:00:00.000Z",
    payload: { message: "Resume el estado del contexto para soporte." },
    links: {},
    metadata: {},
    eventParts: [{
      id: "evt-user-01:0",
      key: "evt-user-01:0",
      index: 0,
      type: "message",
      content: { text: "Resume el estado del contexto para soporte." },
      createdAt: "2026-05-22T12:00:00.000Z",
    }],
  },
  {
    id: "evt-assistant-01",
    type: "assistant.message",
    channel: "web",
    createdAt: "2026-05-22T12:00:05.000Z",
    payload: { answer: "El Context tiene dos Events durables y ninguna Session activa." },
    links: {},
    metadata: {},
    eventParts: [{
      id: "evt-assistant-01:0",
      key: "evt-assistant-01:0",
      index: 0,
      type: "message",
      content: { text: "El Context tiene dos Events durables y ninguna Session activa." },
      createdAt: "2026-05-22T12:00:05.000Z",
    }],
  },
];

function EventContextPanelDemo() {
  const previewDb = useMemo(
    () => ({
      useQuery: () => ({
        data: {
          context_contexts: [
            {
              id: "ctx_demo_01",
              key: "registry.events.preview",
              name: "Registry preview",
              content: {},
              currentSession: null,
              sessions: [],
              events: initialEvents,
            },
          ],
        },
      }),
    }),
    [],
  );

  return (
    <EventContextPanel
      db={previewDb}
      apiUrl="/api/examples/events/context-preview"
      initialContextId="ctx_demo_01"
      contextKey="registry.events.preview"
      className="h-[520px] w-full max-w-2xl"
      defaultPrompt="Agrega el proximo paso"
    />
  );
}

export const eventContextPanelRegistryItem: RegistryItem = {
  id: "event-context-panel",
  registryName: "event-context-panel",
  title: "EventContextPanel",
  subtitle:
    "Installable events-domain component. It imports the canonical @ekairos/events/react API from the package dependency.",
  category: "core",
  props: [
    {
      name: "db",
      type: "InstantDBClient",
      default: "required",
      description: "Domain app database client forwarded to @ekairos/events/react.",
    },
    {
      name: "apiUrl",
      type: "string",
      default: "required",
      description: "Events context endpoint used for snapshots and append calls.",
    },
    {
      name: "contextKey",
      type: "string",
      default: "-",
      description: "Stable domain key for resolving or creating the event context.",
    },
    {
      name: "initialContextId",
      type: "string",
      default: "-",
      description: "Existing context_contexts id used when the caller already has one.",
    },
    {
      name: "onContextUpdate",
      type: "(contextId: string) => void",
      default: "-",
      description: "Callback fired when the canonical context id changes.",
    },
    {
      name: "prepareAppendArgs",
      type: "(args: AppendArgs) => AppendArgs | Promise<AppendArgs>",
      default: "-",
      description: "Domain hook for enriching append payloads before submit.",
    },
    {
      name: "prepareRequestBody",
      type: "(params) => Record<string, unknown> | Promise<Record<string, unknown>>",
      default: "-",
      description: "Domain hook for building the request body sent to the API.",
    },
    {
      name: "className",
      type: "string",
      default: "-",
      description: "Optional className applied to the panel root.",
    },
  ],
  code: `"use client"

import { EventContextPanel } from "@/components/ekairos/events/event-context-panel"
import { useOrgDb } from "@/lib/org-db-context"

export function SupportContextPanel() {
  const { db } = useOrgDb()

  return (
    <EventContextPanel
      db={db}
      apiUrl="/api/events/context"
      contextKey="support.agent.session.42"
    />
  )
}
`,
  render: () => <EventContextPanelDemo />,
};

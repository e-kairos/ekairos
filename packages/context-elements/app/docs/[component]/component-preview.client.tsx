"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import { useContext } from "@ekairos/events/react";
import { getPreviewDb } from "@/lib/client-db";
import { FileTree, FileTreeFile, FileTreeFolder } from "@/components/ai-elements/file-tree";
import { Terminal } from "@/components/ai-elements/terminal";
import {
  Test,
  TestResults,
  TestResultsContent,
  TestSuite,
  TestSuiteContent,
  TestSuiteName,
} from "@/components/ai-elements/test-results";
const Canvas = dynamic(
  () => import("@/components/ai-elements/canvas").then((module) => module.Canvas),
  { ssr: false },
);

type ComponentPreviewClientProps = {
  componentName: string;
  componentCategory: string;
  componentTitle: string;
};

type ContextItem = Record<string, unknown>;
type ContextPart = Record<string, unknown>;

type PreviewMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  textParts: string[];
  toolParts: ContextPart[];
};

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getParts(item: ContextItem): ContextPart[] {
  const parts = asArray(item.eventParts);
  return parts
    .map((entry) => asObject(asObject(entry)?.content) ?? asObject(entry))
    .filter((entry): entry is ContextPart => Boolean(entry));
}

function toPreviewMessages(items: ContextItem[]): PreviewMessage[] {
  return items.map((item) => {
    const id = asString(item.id, makeId());
    const type = asString(item.type, "output_text");
    const createdAt = asString(item.createdAt, new Date().toISOString());
    const parts = getParts(item);
    const textParts: string[] = [];
    const toolParts: ContextPart[] = [];

    for (const part of parts) {
      const partType = asString(part.type);
      if (partType === "text" && typeof part.text === "string") {
        textParts.push(part.text);
        continue;
      }
      if (partType === "message") {
        const content = asObject(part.content);
        if (typeof content?.text === "string") textParts.push(content.text);
        continue;
      }
      if (partType === "tool-call") {
        toolParts.push(part);
      }
    }

    const role: "user" | "assistant" = type.startsWith("input_") ? "user" : "assistant";
    if (textParts.length === 0 && toolParts.length === 0) {
      textParts.push(JSON.stringify(item));
    }

    return { id, role, createdAt, textParts, toolParts };
  });
}

function ChatbotPreview({
  messages,
  accent,
  showJson,
}: {
  messages: PreviewMessage[];
  accent: string;
  showJson: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        className="card"
        style={{ border: `1px solid ${accent}44`, padding: 12, display: "grid", gap: 10, maxHeight: 420, overflow: "auto" }}
      >
          {messages.map((message) => (
            <article
              key={message.id}
              style={{
                marginLeft: message.role === "user" ? "auto" : undefined,
                maxWidth: "92%",
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: 10,
                background:
                  message.role === "user" ? "rgba(55,214,255,0.12)" : "rgba(255,255,255,0.03)",
              }}
            >
              <div className="meta-row" style={{ marginBottom: 8 }}>
                <span>{message.role}</span>
                <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
              </div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                {message.textParts.join("\n\n")}
              </p>
              {message.toolParts.map((part, index) => {
                const toolName = asString(part.toolName, "tool");
                return (
                  <div
                    key={`${message.id}:tool:${index}`}
                    style={{
                      marginTop: 8,
                      border: "1px dashed var(--line)",
                      borderRadius: 8,
                      padding: 8,
                    }}
                  >
                    <div className="meta-row">
                      <span>tool-call</span>
                      <span>{toolName}</span>
                    </div>
                    <pre className="cmd" style={{ marginTop: 6 }}>
                      {JSON.stringify(asObject(part.input) ?? {}, null, 2)}
                    </pre>
                  </div>
                );
              })}
              {showJson ? (
                <pre className="cmd" style={{ marginTop: 8 }}>
                  {JSON.stringify(message, null, 2)}
                </pre>
              ) : null}
            </article>
          ))}
      </div>
    </div>
  );
}

function IdePreview({
  messages,
  accent,
  density,
}: {
  messages: PreviewMessage[];
  accent: string;
  density: "compact" | "comfortable";
}) {
  const [selectedPath, setSelectedPath] = useState<string>("src/context.ts");
  const terminalOutput = messages
    .map((message) => `[${message.role}] ${message.textParts.join(" ").slice(0, 120)}`)
    .join("\n");

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "minmax(220px,320px) minmax(0,1fr)",
        }}
      >
        <FileTree
          className="card"
          defaultExpanded={new Set<string>(["src", "src/components"])}
          onSelect={setSelectedPath}
          selectedPath={selectedPath}
          style={{ border: `1px solid ${accent}44`, padding: density === "compact" ? 8 : 12 }}
        >
          <FileTreeFolder name="src" path="src">
            <FileTreeFile name="context.ts" path="src/context.ts" />
            <FileTreeFolder name="components" path="src/components">
              <FileTreeFile name="Agent.tsx" path="src/components/Agent.tsx" />
              <FileTreeFile name="Sidebar.tsx" path="src/components/Sidebar.tsx" />
            </FileTreeFolder>
          </FileTreeFolder>
          <FileTreeFile name="README.md" path="README.md" />
        </FileTree>

        <Terminal
          className="card"
          isStreaming
          output={terminalOutput || "No terminal output yet."}
          style={{ border: `1px solid ${accent}44` }}
        />
      </div>

      <TestResults
        className="card"
        style={{ border: `1px solid ${accent}44` }}
        summary={{
          total: 3,
          passed: 2,
          failed: 0,
          skipped: 1,
          duration: 1240,
        }}
      >
        <TestResultsContent>
          <TestSuite defaultOpen name="context integration" status="passed">
            <TestSuiteName />
            <TestSuiteContent>
              <Test duration={412} name="loads snapshot from /api/context" status="passed" />
              <Test duration={380} name="renders items in createdAt order" status="passed" />
              <Test duration={0} name="supports streaming deltas" status="skipped" />
            </TestSuiteContent>
          </TestSuite>
        </TestResultsContent>
      </TestResults>
    </div>
  );
}

type ExcalidrawElement = Record<string, unknown>;

function elementBase(id: string, type: string, x: number, y: number, width: number, height: number) {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    boundElements: null,
    frameId: null,
    groupIds: [],
    isDeleted: false,
    link: null,
    locked: false,
    opacity: 100,
    roughness: 1,
    seed: Math.abs(hashString(id)),
    updated: 1,
    version: 1,
    versionNonce: Math.abs(hashString(`${id}:nonce`)),
  };
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return hash || 1;
}

function textElement(id: string, x: number, y: number, text: string, options?: { color?: string; fontSize?: number }) {
  const fontSize = options?.fontSize ?? 20;
  const lines = text.split("\n");
  return {
    ...elementBase(id, "text", x, y, Math.max(120, Math.min(280, text.length * fontSize * 0.48)), lines.length * fontSize * 1.25),
    backgroundColor: "transparent",
    baseline: Math.round(fontSize * 0.8),
    containerId: null,
    fillStyle: "hachure",
    fontFamily: 1,
    fontSize,
    lineHeight: 1.25,
    originalText: text,
    strokeColor: options?.color ?? "#f8fafc",
    strokeStyle: "solid",
    strokeWidth: 1,
    text,
    textAlign: "left",
    verticalAlign: "top",
  };
}

function rectangleElement(id: string, x: number, y: number, width: number, height: number, options: { background: string; stroke: string }) {
  return {
    ...elementBase(id, "rectangle", x, y, width, height),
    backgroundColor: options.background,
    fillStyle: "solid",
    roundness: { type: 3 },
    strokeColor: options.stroke,
    strokeStyle: "solid",
    strokeWidth: 2,
  };
}

function arrowElement(id: string, x: number, y: number, width: number, height: number, stroke: string) {
  return {
    ...elementBase(id, "arrow", x, y, width, height),
    backgroundColor: "transparent",
    endArrowhead: "arrow",
    endBinding: null,
    fillStyle: "hachure",
    points: [
      [0, 0],
      [width, height],
    ],
    startArrowhead: null,
    startBinding: null,
    strokeColor: stroke,
    strokeStyle: "solid",
    strokeWidth: 2,
  };
}

function shortPreviewText(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim() || fallback;
  return normalized.length > 86 ? `${normalized.slice(0, 83)}...` : normalized;
}

function createWorkflowElements({
  accent,
  reaction,
  trigger,
}: {
  accent: string;
  reaction: string;
  trigger: string;
}): ExcalidrawElement[] {
  const triggerText = shortPreviewText(trigger, "Input event");
  const reactionText = shortPreviewText(reaction, "Assistant response");

  return [
    rectangleElement("workflow-trigger-card", 40, 90, 260, 138, {
      background: "#07131f",
      stroke: accent,
    }),
    textElement("workflow-trigger-title", 64, 110, "Trigger", { color: "#f8fafc", fontSize: 22 }),
    textElement("workflow-trigger-status", 64, 140, "completed", { color: accent, fontSize: 15 }),
    textElement("workflow-trigger-body", 64, 168, triggerText, { color: "#cbd5e1", fontSize: 16 }),
    arrowElement("workflow-trigger-reaction-arrow", 316, 159, 72, 0, accent),
    rectangleElement("workflow-reaction-card", 404, 90, 282, 138, {
      background: "#0b1020",
      stroke: accent,
    }),
    textElement("workflow-reaction-title", 428, 110, "Reaction", { color: "#f8fafc", fontSize: 22 }),
    textElement("workflow-reaction-status", 428, 140, "streaming", { color: accent, fontSize: 15 }),
    textElement("workflow-reaction-body", 428, 168, reactionText, { color: "#cbd5e1", fontSize: 16 }),
    rectangleElement("workflow-state-pill", 538, 24, 148, 34, {
      background: "#0f172a",
      stroke: accent,
    }),
    textElement("workflow-state-label", 556, 32, "workflow: streaming", { color: "#f8fafc", fontSize: 14 }),
  ];
}

function WorkflowPreview({
  messages,
  accent,
}: {
  messages: PreviewMessage[];
  accent: string;
}) {
  const workflowElements = useMemo(
    () =>
      createWorkflowElements({
        accent,
        reaction: messages.at(-1)?.textParts.join(" ") ?? "Assistant response",
        trigger: messages[0]?.textParts[0] ?? "Input event",
      }),
    [accent, messages],
  );
  const handleCanvasReady = useCallback(
    (api: any) => {
      window.requestAnimationFrame(() => {
        api?.scrollToContent?.(workflowElements, {
          fitToContent: true,
        });
      });
    },
    [workflowElements],
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        className="card"
        style={{
          border: `1px solid ${accent}44`,
          borderRadius: 12,
          height: 360,
          overflow: "hidden",
        }}
      >
        <Canvas
          appState={{ viewBackgroundColor: "var(--background)" }}
          elements={workflowElements}
          excalidrawAPI={handleCanvasReady}
          theme="dark"
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: false,
              export: false,
              loadScene: false,
              saveAsImage: false,
              saveToActiveFile: false,
              toggleTheme: false,
            },
          }}
        />
      </div>
    </div>
  );
}

function EventList({
  items,
  showJson,
  accent,
  density,
}: {
  items: ContextItem[];
  showJson: boolean;
  accent: string;
  density: "compact" | "comfortable";
}) {
  return (
    <div
      style={{
        border: `1px solid ${accent}55`,
        borderRadius: 12,
        padding: density === "compact" ? 10 : 14,
        display: "grid",
        gap: density === "compact" ? 8 : 12,
        background: "rgba(7,16,28,0.55)",
      }}
    >
      {items.map((item) => {
        const itemId = asString(item.id, makeId());
        const createdAt = asString(item.createdAt);
        const type = asString(item.type, "event");
        const parts = getParts(item);
        const summary =
          parts
            .map((part) => (part.type === "text" ? asString(part.text) : asString(part.type)))
            .filter(Boolean)
            .join(" | ")
            .slice(0, 180) || JSON.stringify(item).slice(0, 180);

        return (
          <article
            className="element-card"
            key={`${itemId}:${createdAt}`}
            style={{
              background: "rgba(8,13,24,0.92)",
              borderColor: `${accent}40`,
              padding: density === "compact" ? 10 : 13,
            }}
          >
            <div className="meta-row">
              <span>{type}</span>
              <span>{createdAt ? new Date(createdAt).toLocaleTimeString() : "-"}</span>
            </div>
            <h3 style={{ margin: 0, fontSize: density === "compact" ? 14 : 15 }}>{summary}</h3>
            {showJson ? (
              <pre className="cmd" style={{ marginTop: 6 }}>
                {JSON.stringify(item, null, 2)}
              </pre>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function LiveContextPreview(props: {
  componentName: string;
  componentCategory: string;
  contextKey: string;
  contextId: string;
  maxItems: number;
  density: "compact" | "comfortable";
  accent: string;
  showJson: boolean;
  appId: string;
}) {
  const context = useContext(getPreviewDb(props.appId), {
    apiUrl: `/api/context/${encodeURIComponent(props.contextKey)}`,
    contextKey: props.contextKey,
    initialContextId: props.contextId,
  });

  const items = useMemo(
    () => context.events.slice(-Math.max(1, props.maxItems)),
    [context.events, props.maxItems],
  );
  const messages = useMemo(() => toPreviewMessages(items), [items]);
  const runReaction = useCallback(async () => {
    await context.append({
      parts: [
        {
          type: "text",
          text: `Run ${props.componentName} through the Reactor template.`,
        },
      ],
    });
  }, [context, props.componentName]);

  const previewBody = useMemo(() => {
    if (props.componentCategory === "chatbot") {
      return <ChatbotPreview accent={props.accent} messages={messages} showJson={props.showJson} />;
    }
    if (props.componentCategory === "code") {
      return <IdePreview accent={props.accent} density={props.density} messages={messages} />;
    }
    if (props.componentCategory === "workflow") {
      return <WorkflowPreview accent={props.accent} messages={messages} />;
    }
    return (
      <EventList
        accent={props.accent}
        density={props.density}
        items={items}
        showJson={props.showJson}
      />
    );
  }, [items, messages, props]);

  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button
          className="btn"
          type="button"
          onClick={() => void runReaction()}
          disabled={context.sendStatus === "submitting"}
          style={{ cursor: context.sendStatus === "submitting" ? "wait" : "pointer" }}
        >
          {context.sendStatus === "submitting" ? "Running reaction..." : "Run reaction"}
        </button>
        <span className="pill">{props.componentCategory}</span>
        <span className="pill">{context.contextStatus}</span>
        <span className="pill">{context.events.length} events</span>
        <span className="pill">{context.activeSessionId ? "active session" : "synced"}</span>
      </div>

      {context.sendError ? (
        <div className="context-strip">
          <h3>Reaction Error</h3>
          <p>{context.sendError}</p>
        </div>
      ) : null}

      {previewBody}

      {props.showJson ? (
        <pre className="cmd" style={{ marginTop: 12 }}>
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
      ) : null}
    </>
  );
}

export function ComponentPreviewClient(props: ComponentPreviewClientProps) {
  const [contextKey, setContextKey] = useState(`preview-${props.componentName}`);
  const [maxItems, setMaxItems] = useState(8);
  const [density, setDensity] = useState<"compact" | "comfortable">("comfortable");
  const [showJson, setShowJson] = useState(false);
  const [accent, setAccent] = useState("#37d6ff");
  const [runtime, setRuntime] = useState<{
    appId: string;
    contextId: string;
    loading: boolean;
    error: string | null;
  }>({ appId: "", contextId: "", loading: true, error: null });

  useEffect(() => {
    let active = true;
    setRuntime((current) => ({ ...current, loading: true, error: null }));
    void fetch(`/api/context/${encodeURIComponent(contextKey)}?ensure=1`)
      .then(async (response) => {
        const body = (await response.json()) as Record<string, unknown>;
        if (!response.ok) throw new Error(asString(body.error, `Context request failed (${response.status}).`));
        if (!active) return;
        setRuntime({
          appId: asString(body.appId),
          contextId: asString(body.contextId),
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
  }, [contextKey]);

  return (
    <section className="card doc-panel">
      <h2 style={{ marginBottom: 12 }}>Live Preview Playground</h2>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          marginBottom: 12,
        }}
      >
        <label style={{ display: "grid", gap: 6 }}>
          <span className="section-desc">contextKey</span>
          <input
            value={contextKey}
            onChange={(event) => setContextKey(event.target.value)}
            style={{
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface-muted)",
              color: "var(--fg)",
              padding: "8px 10px",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span className="section-desc">maxItems</span>
          <input
            type="number"
            min={1}
            max={20}
            value={maxItems}
            onChange={(event) => setMaxItems(Number(event.target.value || 1))}
            style={{
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface-muted)",
              color: "var(--fg)",
              padding: "8px 10px",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span className="section-desc">density</span>
          <select
            value={density}
            onChange={(event) =>
              setDensity(event.target.value === "compact" ? "compact" : "comfortable")
            }
            style={{
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface-muted)",
              color: "var(--fg)",
              padding: "8px 10px",
            }}
          >
            <option value="comfortable">comfortable</option>
            <option value="compact">compact</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span className="section-desc">accent</span>
          <input
            type="color"
            value={accent}
            onChange={(event) => setAccent(event.target.value)}
            style={{ borderRadius: 8, border: "1px solid var(--line)", minHeight: 38 }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button
          className="btn"
          type="button"
          onClick={() => setShowJson((prev) => !prev)}
          style={{ cursor: "pointer" }}
        >
          {showJson ? "Hide JSON" : "Show JSON"}
        </button>
        <span className="pill">event -&gt; reaction -&gt; steps</span>
      </div>

      <div data-ek-context-element-preview={props.componentName}>
        {runtime.error ? (
          <div className="context-strip">
            <h3>Preview Error</h3>
            <p>{runtime.error}</p>
          </div>
        ) : null}

        {runtime.loading ? (
          <div className="context-strip">
            <h3>Loading</h3>
            <p>Creating a temporary InstantDB app and preparing the reaction context.</p>
          </div>
        ) : null}

        {!runtime.loading && runtime.appId && runtime.contextId ? (
          <LiveContextPreview
            appId={runtime.appId}
            componentCategory={props.componentCategory}
            componentName={props.componentName}
            contextId={runtime.contextId}
            contextKey={contextKey}
            maxItems={maxItems}
            density={density}
            accent={accent}
            showJson={showJson}
          />
        ) : null}
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import { Prompt } from "@/components/ekairos/events/prompt/prompt";
import PromptFileChip, {
  type PromptAttachment,
} from "@/components/ekairos/events/prompt/prompt-file-chip";
import { FileIcon } from "@/components/ekairos/events/prompt/file-icon";
import {
  ContextActivityIndicator,
  type ContextActivityState,
} from "@/components/ekairos/events/context-agent/ui/context-activity-indicator";
import { MessageArtifact } from "@/components/ekairos/events/context-agent/ui/message-artifact";
import {
  TemporalEvidenceList,
  type TemporalEvidenceItem,
} from "@/components/ekairos/events/context-agent/ui/temporal-evidence-list";
import {
  SourceWatchStatus,
  type SourceWatchStatusValue,
} from "@/components/ekairos/events/context-agent/ui/source-watch-status";

/* ----------------------------------------------------------------- Prompt */

export function PromptBasicPreview() {
  const [value, setValue] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      <Prompt
        value={value}
        onChange={setValue}
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          setSent(value.trim());
          setValue("");
        }}
        placeholder="Ask the agent to do something..."
      />
      {sent ? (
        <p className="font-mono text-xs text-muted-foreground">submitted: &ldquo;{sent}&rdquo;</p>
      ) : null}
    </div>
  );
}

const PROMPT_STATUSES = ["idle", "submitted", "streaming", "error"] as const;

export function PromptStatusPreview() {
  const [value, setValue] = useState("Summarize the latest replay session");
  const [status, setStatus] = useState<(typeof PROMPT_STATUSES)[number]>("streaming");
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1.5">
        {PROMPT_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={
              status === s
                ? "border border-foreground px-2 py-1 font-mono text-[11px]"
                : "border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            }
          >
            {s}
          </button>
        ))}
      </div>
      <Prompt
        value={value}
        onChange={setValue}
        onSubmit={(e) => e.preventDefault()}
        status={status}
        onStop={status === "streaming" ? () => setStatus("idle") : undefined}
      />
    </div>
  );
}

export function PromptAttachmentsPreview() {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<PromptAttachment[]>([
    { id: "a1", name: "tender-spec.pdf", size: "1.2 MB", type: "application/pdf", status: "done" },
    { id: "a2", name: "bid-items.xlsx", size: "84 KB", type: "application/vnd.ms-excel", status: "done" },
  ]);
  return (
    <Prompt
      value={value}
      onChange={setValue}
      onSubmit={(e) => e.preventDefault()}
      attachments={attachments}
      onRemoveAttachment={(id) => setAttachments((cur) => cur.filter((f) => f.id !== id))}
      onFilesSelected={(files) =>
        setAttachments((cur) => [
          ...cur,
          ...Array.from(files).map((file, index) => ({
            id: `picked-${Date.now()}-${index}`,
            name: file.name,
            type: file.type,
            status: "done" as const,
          })),
        ])
      }
      hasNonTextSendPayload={attachments.length > 0}
    />
  );
}

/* --------------------------------------------------------- PromptFileChip */

export function FileChipStatesPreview() {
  return (
    <div className="flex flex-wrap gap-2">
      <PromptFileChip
        file={{ id: "c1", name: "quarterly-report.pdf", size: "2.4 MB", type: "application/pdf", status: "done" }}
        onRemove={() => {}}
      />
      <PromptFileChip
        file={{ id: "c2", name: "site-photos.zip", size: "18 MB", status: "uploading" }}
      />
      <PromptFileChip
        file={{ id: "c3", name: "broken-upload.csv", type: "text/csv", status: "error" }}
        onRemove={() => {}}
      />
    </div>
  );
}

export function FileChipArtifactPreview() {
  const [pressed, setPressed] = useState(false);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <PromptFileChip
          file={{
            id: "art1",
            name: "Revenue chart (in thread)",
            status: "done",
            kind: "artifact-context",
            onPress: () => setPressed(true),
          }}
          onRemove={() => {}}
        />
      </div>
      {pressed ? (
        <p className="font-mono text-xs text-muted-foreground">
          onPress fired — in a real app this scrolls to the artifact in the thread.
        </p>
      ) : null}
    </div>
  );
}

export function FileIconRowPreview() {
  const files = [
    "report.pdf",
    "data.xlsx",
    "photo.png",
    "demo.mp4",
    "voice.mp3",
    "archive.zip",
    "notes.docx",
    "readme.txt",
  ];
  return (
    <div className="flex flex-wrap gap-4">
      {files.map((name) => (
        <span key={name} className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <FileIcon name={name} />
          {name}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------- ContextActivityIndicator */

const ACTIVITY_STATES: Array<{ name: string; state: ContextActivityState }> = [
  {
    name: "thinking",
    state: { label: "Pensando", animated: true, pattern: "rings", speed: 1.25, tone: "info" },
  },
  {
    name: "responding",
    state: { label: "Respondiendo", animated: true, pattern: "full", speed: 2.4, tone: "info" },
  },
  {
    name: "working (action)",
    state: {
      label: "Trabajando",
      title: "Reconcile supplier bid items",
      animated: true,
      pattern: "full",
      speed: 3.2,
      tone: "warning",
    },
  },
  {
    name: "uploading",
    state: { label: "Subiendo", animated: true, pattern: "outline", speed: 2.2, tone: "info" },
  },
  {
    name: "error",
    state: {
      label: "Error",
      title: "The last turn ended with an error.",
      animated: false,
      pattern: "cross",
      speed: 1,
      tone: "error",
      phase: "error",
    },
  },
];

export function ActivityStatesPreview() {
  return (
    <div className="grid gap-2">
      {ACTIVITY_STATES.map(({ name, state }) => (
        <div key={name} className="flex items-center gap-3">
          <div className="w-40 shrink-0 font-mono text-[11px] text-muted-foreground">{name}</div>
          <ContextActivityIndicator activity={state} density="compact" />
        </div>
      ))}
    </div>
  );
}

export function ActivityFinishingPreview() {
  const [activity, setActivity] = useState<ContextActivityState | null>(null);
  const streaming = activity !== null;
  return (
    <div className="grid gap-3">
      <div>
        <button
          type="button"
          onClick={() =>
            setActivity(
              streaming
                ? null
                : { label: "Respondiendo", animated: true, pattern: "full", speed: 2.4, tone: "info" },
            )
          }
          className="border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          {streaming ? "finish turn" : "start streaming"}
        </button>
      </div>
      <div className="min-h-8">
        <ContextActivityIndicator activity={activity} />
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">
        {streaming
          ? "live — click again to watch the finishing → idle → fade-out sequence"
          : "idle — nothing rendered once the fade-out completes"}
      </p>
    </div>
  );
}

/* ----------------------------------------------------- MessageArtifact */

export function MessageArtifactBasicPreview() {
  return (
    <MessageArtifact title="supplier-quote-comparison.md">
      <pre className="m-0 overflow-x-auto font-mono text-xs leading-6 text-muted-foreground">
{`| Supplier | Unit price | Lead time |
|----------|------------|-----------|
| Acme     | USD 11.40  | 10 days   |
| Norte    | USD 12.10  | 6 days    |`}
      </pre>
    </MessageArtifact>
  );
}

export function MessageArtifactFullPreview() {
  const [opened, setOpened] = useState(false);
  return (
    <div className="grid gap-3">
      <MessageArtifact
        eyebrow="Generated file"
        title="reconciliation-report.xlsx"
        description="212 bid items matched against 3 supplier quotes"
        actions={
          <button
            type="button"
            onClick={() => setOpened(true)}
            className="border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            Open
          </button>
        }
      >
        <p className="m-0 text-xs leading-6 text-muted-foreground">
          Sheet 1: matched items (198). Sheet 2: needs review (14). Generated by the
          reconcileSupplierBidItems action on this turn.
        </p>
      </MessageArtifact>
      {opened ? (
        <p className="font-mono text-xs text-muted-foreground">action fired — wire this to your viewer.</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------ TemporalEvidenceList */

const EVIDENCE_ITEMS: TemporalEvidenceItem[] = [
  { time: 12, label: "Operator opens the tender form", kind: "replay", note: "session #4812" },
  { time: 95, label: "Supplier quote pasted into chat", kind: "replay", note: "session #4812" },
  { time: 188, label: "Price mismatch flagged", kind: "trace", sourceRef: "step reconcile.compare" },
  { time: 251, label: "Manual override applied", kind: "replay", note: "session #4812" },
  { label: "Original RFQ document", kind: "doc", note: "tender-spec.pdf, page 3" },
];

export function TemporalEvidenceBasicPreview() {
  return <TemporalEvidenceList items={EVIDENCE_ITEMS} />;
}

export function TemporalEvidenceInteractivePreview() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const getItemKey = (item: TemporalEvidenceItem, index: number) =>
    `${item.kind ?? "evidence"}:${index}`;
  return (
    <div className="grid gap-3">
      <TemporalEvidenceList
        items={EVIDENCE_ITEMS}
        title="Replay cues"
        maxItems={4}
        activeItemKey={activeKey}
        getItemKey={getItemKey}
        onSelectItem={(item, index) => setActiveKey(getItemKey(item, index))}
      />
      <p className="font-mono text-xs text-muted-foreground">
        {activeKey ? `selected: ${activeKey} — seek your player here` : "click a cue to select it"}
      </p>
    </div>
  );
}

/* -------------------------------------------------- SourceWatchStatus */

const WATCH_PHASES: SourceWatchStatusValue[] = [
  { phase: "checking", sourceLabel: "Replay folder", sourcePath: "s3://replays/session-4812", pollIntervalMs: 5000 },
  { phase: "waiting", sourceLabel: "Replay folder", detail: "Files still changing, waiting for a stable snapshot", pollIntervalMs: 5000 },
  { phase: "loading", sourceLabel: "Replay folder", detail: "Parsing 3 capture files", sourceCount: 3 },
  { phase: "loaded", sourceLabel: "Replay folder", sourceCount: 3, checkedAt: new Date("2026-06-10T14:32:08"), pollIntervalMs: 30000 },
  { phase: "empty", sourceLabel: "Webhook stream", detail: "No events received yet", pollIntervalMs: 10000 },
  { phase: "error", sourceLabel: "Imports feed", detail: "Credentials expired for the imports bucket" },
];

export function SourceWatchPhasesPreview() {
  return (
    <div className="grid gap-2">
      {WATCH_PHASES.map((status) => (
        <SourceWatchStatus key={status.phase} status={status} />
      ))}
    </div>
  );
}

export function SourceWatchOpenPreview() {
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      <SourceWatchStatus
        status={{
          phase: "loaded",
          sourceLabel: "Replay folder",
          sourcePath: "s3://replays/session-4812",
          sourceCount: 3,
          checkedAt: new Date("2026-06-10T14:32:08"),
          pollIntervalMs: 30000,
        }}
        labels={{ loaded: "Replay ready" }}
        onOpen={() => setOpenedAt(new Date().toLocaleTimeString())}
      />
      {openedAt ? (
        <p className="font-mono text-xs text-muted-foreground">onOpen fired at {openedAt}</p>
      ) : null}
    </div>
  );
}

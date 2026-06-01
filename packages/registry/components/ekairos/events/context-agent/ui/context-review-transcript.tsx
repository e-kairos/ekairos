"use client";

import React, { useMemo, useState } from "react";
import {
  INPUT_TEXT_ITEM_TYPE,
  type ContextEventForUI,
  type ContextValue,
} from "@ekairos/events/react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import {
  getActionPartInfo,
  getCreateMessageText,
  getPartText,
  normalizeContextEventParts,
} from "../context-event-parts";

export type ContextReviewTranscriptProps = {
  className?: string;
  context: Pick<ContextValue, "contextStatus" | "events" | "sendStatus">;
  maxTurns?: number;
  onSelectTurn?: (eventId: string) => void;
};

type ReviewTurn = {
  actionErrors: string[];
  actionParts: number;
  analysis: ReviewAnalysisPayload | null;
  attachments: ReviewAttachment[];
  id: string;
  inputText: string;
  outputText: string;
  status: string;
};

type ReviewAttachment = {
  filename: string;
  kind: string;
  mediaType: string;
};

type ReviewAnalysisPayload = {
  answer?: string;
  comments?: unknown[];
  evidence?: unknown[];
  imagegen?: Record<string, unknown> | null;
  replayControls?: unknown[];
  snapshots?: unknown[];
};

export function ContextReviewTranscript({
  className,
  context,
  maxTurns = 6,
  onSelectTurn,
}: ContextReviewTranscriptProps) {
  const turns = buildReviewTurns(context.events).slice(-maxTurns);
  const reviewMarkdown = useMemo(
    () => buildContextReviewMarkdown(context, maxTurns),
    [context, maxTurns],
  );
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopyMarkdown() {
    if (!reviewMarkdown.trim()) return;

    try {
      await writeClipboardText(reviewMarkdown);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1800);
    }
  }

  function handleDownloadMarkdown() {
    if (!reviewMarkdown.trim()) return;

    const blob = new Blob([reviewMarkdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "context-review.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      aria-label="Context review transcript"
      className={cn(
        "grid gap-3 border-b border-border/70 bg-background px-4 py-3 md:px-6",
        className,
      )}
    >
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-[10px] font-semibold uppercase text-muted-foreground">
            review
          </span>
          <h3 className="mt-0.5 truncate text-sm font-semibold">Transcript</h3>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5 font-mono text-[10px] text-muted-foreground">
            <span>{context.events.length} events</span>
            <span>{turns.length} turns</span>
            <span>{context.contextStatus}</span>
            <span>{context.sendStatus}</span>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <button
              className="min-h-7 rounded-sm border border-border bg-background px-2 font-mono text-[10px] text-muted-foreground hover:border-accent hover:text-accent disabled:opacity-50"
              data-testid="copy-context-review-markdown"
              disabled={!reviewMarkdown.trim()}
              onClick={() => void handleCopyMarkdown()}
              type="button"
            >
              {copyState === "copied"
                ? "Copied"
                : copyState === "failed"
                  ? "Copy failed"
                  : "Copy .md"}
            </button>
            <button
              className="min-h-7 rounded-sm border border-border bg-background px-2 font-mono text-[10px] text-muted-foreground hover:border-accent hover:text-accent disabled:opacity-50"
              data-testid="download-context-review-markdown"
              disabled={!reviewMarkdown.trim()}
              onClick={handleDownloadMarkdown}
              type="button"
            >
              Download .md
            </button>
          </div>
        </div>
      </header>

      {turns.length ? (
        <div className="grid auto-cols-[minmax(22rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1 max-md:grid-flow-row max-md:auto-cols-auto">
          {turns.map((turn) => (
            <ReviewTurnCard
              key={turn.id}
              onSelect={onSelectTurn ? () => onSelectTurn(turn.id) : undefined}
              turn={turn}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No execution transcript yet.</p>
      )}
    </section>
  );
}

export function buildContextReviewMarkdown(
  context: Pick<ContextValue, "contextStatus" | "events" | "sendStatus">,
  maxTurns = 6,
): string {
  const turns = buildReviewTurns(context.events).slice(-maxTurns);
  const lines = [
    "# Ekairos Context Review",
    "",
    `- Status: ${context.contextStatus}`,
    `- Send status: ${context.sendStatus}`,
    `- Events: ${context.events.length}`,
    `- Turns: ${turns.length}`,
    "",
  ];

  if (!turns.length) {
    lines.push("No execution transcript yet.");
    return lines.join("\n");
  }

  for (const turn of turns) {
    lines.push(
      `## Turn ${turn.id}`,
      "",
      `- Status: ${turn.status}`,
      `- Actions: ${turn.actionParts}`,
      "",
      "### Input",
      "",
      turn.inputText || "No visible input.",
      "",
    );

    if (turn.attachments.length) {
      lines.push("Attachments:", "");
      for (const attachment of turn.attachments) {
        lines.push(`- ${attachment.kind}: ${attachment.filename} (${attachment.mediaType})`);
      }
      lines.push("");
    }

    lines.push("### Output", "");
    if (turn.analysis) {
      lines.push(turn.analysis.answer || turn.outputText || "No visible output.", "");
      lines.push(
        `- Comments: ${asArray(turn.analysis.comments).length}`,
        `- Evidence: ${asArray(turn.analysis.evidence).length}`,
        `- Replay controls: ${asArray(turn.analysis.replayControls).length}`,
        `- Snapshots: ${asArray(turn.analysis.snapshots).length}`,
      );
      const imagegen = asRecord(turn.analysis.imagegen);
      const imageTitle = asText(imagegen.title);
      if (imageTitle) {
        lines.push(`- Imagegen: ${imageTitle}`);
      }
      const evidence = asArray(turn.analysis.evidence);
      if (evidence.length) {
        lines.push("", "Evidence:");
        for (const item of evidence.slice(0, 5)) {
          const record = asRecord(item);
          const label = asText(record.label) || "evidence";
          const moment = formatMoment(record.time);
          lines.push(`- ${label}${moment ? ` (${moment})` : ""}`);
        }
      }
      lines.push("");
    } else {
      lines.push(turn.outputText || "No visible output.", "");
    }

    if (turn.actionErrors.length) {
      lines.push("Action errors:", "");
      for (const error of turn.actionErrors) {
        lines.push(`- ${error}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function ReviewTurnCard({
  onSelect,
  turn,
}: {
  onSelect?: () => void;
  turn: ReviewTurn;
}) {
  return (
    <article className="min-w-0 border border-border/70 bg-muted/15">
      <button
        className="flex min-h-9 w-full min-w-0 items-center justify-between gap-2 border-b border-border/70 bg-transparent px-3 py-2 text-left hover:bg-muted/35"
        disabled={!onSelect}
        onClick={onSelect}
        type="button"
      >
        <span className="font-mono text-[10px] uppercase text-muted-foreground">
          {turn.status}
        </span>
        <strong className="min-w-0 truncate font-mono text-[11px]">
          {shortId(turn.id)}
        </strong>
        <span className="font-mono text-[10px] text-muted-foreground">
          {turn.actionParts} actions
        </span>
      </button>

      <div className="grid min-h-40 grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] max-md:grid-cols-1">
        <ReviewMessage
          attachments={turn.attachments}
          label="input"
          text={turn.inputText}
        />
        <ReviewMessage
          actionErrors={turn.actionErrors}
          analysis={turn.analysis}
          label="output"
          text={turn.outputText}
        />
      </div>
    </article>
  );
}

function ReviewMessage({
  actionErrors = [],
  analysis,
  attachments = [],
  label,
  text,
}: {
  actionErrors?: string[];
  analysis?: ReviewAnalysisPayload | null;
  attachments?: ReviewAttachment[];
  label: "input" | "output";
  text: string;
}) {
  return (
    <section
      className={cn(
        "grid min-w-0 content-start gap-2 border-border/70 p-3",
        "data-[kind=output]:border-l max-md:data-[kind=output]:border-l-0",
        "max-md:data-[kind=output]:border-t",
      )}
      data-kind={label}
    >
      <header>
        <span className="font-mono text-[10px] font-semibold uppercase text-muted-foreground">
          {label}
        </span>
      </header>

      {analysis ? (
        <AnalysisReview analysis={analysis} fallbackText={text} />
      ) : (
        <div className="max-h-36 overflow-auto text-xs leading-5">
          <Streamdown parseIncompleteMarkdown skipHtml>
            {text || "No visible message."}
          </Streamdown>
        </div>
      )}

      {attachments.length ? (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <span
              className="inline-grid min-w-0 max-w-full border border-border/70 bg-background px-1.5 py-1"
              key={`${attachment.kind}:${attachment.filename}`}
            >
              <strong className="font-mono text-[10px] text-muted-foreground">
                {attachment.kind}
              </strong>
              <em className="truncate font-mono text-[10px] not-italic text-foreground/80">
                {attachment.filename}
              </em>
            </span>
          ))}
        </div>
      ) : null}

      {actionErrors.length ? (
        <div className="grid gap-1">
          {actionErrors.map((error) => (
            <p
              className="border-l-2 border-destructive bg-destructive/10 px-2 py-1 text-xs text-destructive"
              key={error}
            >
              {error}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AnalysisReview({
  analysis,
  fallbackText,
}: {
  analysis: ReviewAnalysisPayload;
  fallbackText: string;
}) {
  const answer = analysis.answer || fallbackText;
  const evidence = asArray(analysis.evidence);
  const comments = asArray(analysis.comments);
  const controls = asArray(analysis.replayControls);
  const snapshots = asArray(analysis.snapshots);
  const imagegen = asRecord(analysis.imagegen);
  const imageTitle = asText(imagegen.title);

  return (
    <div className="grid gap-2">
      <div className="max-h-36 overflow-auto text-xs leading-5">
        <Streamdown parseIncompleteMarkdown skipHtml>
          {answer}
        </Streamdown>
      </div>

      <div className="flex flex-wrap gap-1.5 font-mono text-[10px] text-muted-foreground">
        <span>{comments.length} comments</span>
        <span>{evidence.length} evidence</span>
        <span>{controls.length} controls</span>
        <span>{snapshots.length} snapshots</span>
      </div>

      {imageTitle ? (
        <p className="flex min-w-0 gap-1.5 text-xs text-muted-foreground">
          <strong className="text-accent">imagegen</strong>
          <span className="truncate">{imageTitle}</span>
        </p>
      ) : null}

      {evidence.length ? (
        <ul className="grid gap-1">
          {evidence.slice(0, 3).map((item, index) => (
            <li className="flex min-w-0 justify-between gap-2 text-xs" key={index}>
              <strong className="min-w-0 truncate font-medium">
                {asText(asRecord(item).label) || `evidence ${index + 1}`}
              </strong>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {formatMoment(asRecord(item).time)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function buildReviewTurns(events: ContextEventForUI[]): ReviewTurn[] {
  const turns: ReviewTurn[] = [];
  let pendingInput: ContextEventForUI | null = null;

  for (const event of events) {
    if (isUserEvent(event)) {
      pendingInput = event;
      continue;
    }

    const inputParts = normalizeContextEventParts(pendingInput?.content?.parts ?? []);
    const reactionParts = normalizeContextEventParts(event.content?.parts ?? []);
    const stepParts = (event.steps ?? []).flatMap((step) =>
      normalizeContextEventParts(step?.parts ?? []),
    );
    const messageParts = [...reactionParts, ...stepParts].filter(
      (part) =>
        !getActionPartInfo(part) &&
        asText(asRecord(part).type) !== "reasoning",
    );
    const outputText =
      lastNonEmpty(messageParts.map(readMessageText)) || previewEvent(event);
    const actionParts = stepParts.filter((part) => getActionPartInfo(part));

    turns.push({
      actionErrors: actionParts
        .map((part) => getActionPartInfo(part)?.errorText ?? "")
        .filter(Boolean)
        .slice(0, 3),
      actionParts: actionParts.length,
      analysis: parseAnalysisPayload(outputText),
      attachments: [...inputParts, ...reactionParts]
        .map(readAttachment)
        .filter((attachment): attachment is ReviewAttachment => Boolean(attachment)),
      id: String(event.id),
      inputText:
        firstNonEmpty(inputParts.map(readMessageText)) ||
        (pendingInput ? previewEvent(pendingInput) : ""),
      outputText,
      status: asText(event.status) || "stored",
    });

    pendingInput = null;
  }

  if (pendingInput) {
    const inputParts = normalizeContextEventParts(pendingInput.content?.parts ?? []);
    turns.push({
      actionErrors: [],
      actionParts: 0,
      analysis: null,
      attachments: inputParts
        .map(readAttachment)
        .filter((attachment): attachment is ReviewAttachment => Boolean(attachment)),
      id: String(pendingInput.id),
      inputText:
        firstNonEmpty(inputParts.map(readMessageText)) || previewEvent(pendingInput),
      outputText: "",
      status: asText(pendingInput.status) || "stored",
    });
  }

  return turns;
}

function isUserEvent(event: ContextEventForUI) {
  const type = String(event?.type ?? "");
  return (
    type === INPUT_TEXT_ITEM_TYPE ||
    type === "input" ||
    type.startsWith("user.")
  );
}

function previewEvent(event: ContextEventForUI) {
  const text =
    firstNonEmpty(
      normalizeContextEventParts(event.content?.parts ?? []).map(readMessageText),
    ) ||
    String(event.type ?? "");
  return text.trim();
}

function readMessageText(part: unknown) {
  return (
    safeText(() => getPartText(part)) ||
    safeText(() => getCreateMessageText(part))
  ).trim();
}

function readAttachment(part: unknown): ReviewAttachment | null {
  const record = asRecord(part);
  const type = asText(record.type);
  const mediaType = asText(record.mediaType);
  const filename = asText(record.filename) || asText(record.name);
  const providerMetadata = asRecord(record.providerMetadata);
  const ekairos = asRecord(providerMetadata.ekairos);
  const kind =
    asText(ekairos.artifactKind) ||
    asText(ekairos.kind) ||
    type;

  if (type !== "file" && !filename && !mediaType && !kind) {
    return null;
  }

  return {
    filename: filename || "attachment",
    kind: kind || "file",
    mediaType: mediaType || "application/octet-stream",
  };
}

function parseAnalysisPayload(text: string): ReviewAnalysisPayload | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const record = asRecord(JSON.parse(trimmed));
    const hasReviewShape =
      typeof record.answer === "string" ||
      Array.isArray(record.evidence) ||
      Array.isArray(record.replayControls) ||
      Boolean(record.imagegen);
    return hasReviewShape ? (record as ReviewAnalysisPayload) : null;
  } catch {
    return null;
  }
}

function safeText(read: () => string) {
  try {
    return read().trim();
  } catch {
    return "";
  }
}

function firstNonEmpty(values: string[]) {
  return values.find((value) => value.trim().length > 0)?.trim() ?? "";
}

function lastNonEmpty(values: string[]) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]?.trim();
    if (value) return value;
  }
  return "";
}

function shortId(value: string) {
  return value.length > 13 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatMoment(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1)}s`
    : "";
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("copy failed");
  }
}

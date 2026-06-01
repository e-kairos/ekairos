"use client";

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INPUT_TEXT_ITEM_TYPE, type ContextValue } from "@ekairos/events/react";
import { id } from "@instantdb/react";
import { DotmSquare10 } from "@/components/ui/dotm-square-10";
import { Prompt } from "../../prompt/prompt";
import type { PromptAttachment } from "../../prompt/prompt-file-chip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOrgDb } from "@/lib/org-db-context";
import { cn } from "@/lib/utils";

import {
  getActionPartInfo,
  getPartText,
  getReasoningText,
} from "../context-event-parts";
import type { MatrixPattern } from "@/lib/dotmatrix-core";
import type { ArtifactPromptAttachmentPayload } from "../agent-prompt-bridge";
import { useAgentPromptBridge } from "../agent-prompt-bridge";

type FileUIPart = {
  type: "file";
  url?: string;
  mediaType?: string;
  filename?: string;
  providerMetadata?: any;
};

type ChatAttachment = PromptAttachment & {
  filePart?: FileUIPart;
  path?: string;
  fileId?: string;
};

type FileSelection = FileList | File[];

type ContextActivityTone = "neutral" | "info" | "warning" | "error";
type ContextActivityPhase = "idle" | "live" | "finishing" | "error";

type ContextActivityState = {
  label: string;
  title?: string;
  animated?: boolean;
  pattern: MatrixPattern;
  phase?: ContextActivityPhase;
  speed: number;
  tone?: ContextActivityTone;
};

const FINISHING_ANIMATION_MS = 1550;
const IDLE_AFTER_FINISH_MS = 850;
const ACTIVITY_FADE_OUT_MS = 320;

const IDLE_CONTEXT_ACTIVITY: ContextActivityState = {
  label: "Listo",
  animated: true,
  pattern: "outline",
  phase: "idle",
  speed: 1,
  tone: "neutral",
};

const FINISHING_CONTEXT_ACTIVITY: ContextActivityState = {
  label: "Finalizando",
  animated: true,
  pattern: "diamond",
  phase: "finishing",
  speed: 1.4,
  tone: "info",
};

function shouldPlayTerminalFinishing(
  activity: ContextActivityState | null,
): activity is ContextActivityState {
  if (!activity) return false;
  const phase = activity.phase ?? (activity.tone === "error" ? "error" : "live");
  return phase === "live";
}

function buildArtifactContextFilePart(
  payload: ArtifactPromptAttachmentPayload,
): FileUIPart {
  const body = {
    data: payload.data,
    instruction: payload.instruction,
    kind: payload.kind,
    mediaType: payload.mediaType,
    metadata: payload.metadata,
    subtitle: payload.subtitle,
    title: payload.title,
  };
  const json = JSON.stringify(body, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  const baseName = sanitizeFileName(
    payload.fileName?.replace(/\.json$/i, "") ||
      `${payload.kind || "artifact"}-${payload.title || "context"}`,
  );
  return {
    type: "file",
    url: dataUrl,
    mediaType: "application/json",
    filename: payload.fileName
      ? sanitizeFileName(payload.fileName)
      : `${baseName}.json`,
    providerMetadata: {
      ekairos: {
        artifactKind: payload.kind,
        artifactMediaType: payload.mediaType,
        kind: "artifact-context",
        metadata: payload.metadata,
        title: payload.title,
      },
    },
  };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
}

function scrollToArtifactAnchor(actionCallId?: string) {
  if (!actionCallId || typeof document === "undefined") return;
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(actionCallId)
      : actionCallId.replace(/["\\]/g, "");
  const selectors = [
    `[data-ek-artifact-anchor="${escaped}"]`,
    `[data-ek-chart-anchor="${escaped}"]`,
  ];
  window.requestAnimationFrame(() => {
    for (const selector of selectors) {
      const target = document.querySelector(selector);
      if (!target) continue;
      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / Math.pow(1024, exponent);
  return (
    (exponent === 0
      ? Math.round(value).toString()
      : value.toFixed(1).replace(/\.0$/, "")) +
    " " +
    units[exponent]
  );
}

function isUserEventType(type: unknown): boolean {
  const value = String(type ?? "");
  return (
    value === INPUT_TEXT_ITEM_TYPE ||
    value === "input" ||
    value.startsWith("user.")
  );
}

function latestAssistantEvent(context: ContextValue) {
  for (let i = context.events.length - 1; i >= 0; i -= 1) {
    const event = context.events[i];
    if (!isUserEventType(event?.type)) return event;
  }
  return null;
}

function latestRunningStep(context: ContextValue) {
  const assistant = latestAssistantEvent(context);
  const steps = Array.isArray(assistant?.steps) ? assistant.steps : [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step?.status === "running") return step;
  }
  return null;
}

function latestStartedActionName(parts: Array<Record<string, unknown>>) {
  const terminalActionIds = new Set<string>();
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const action = getActionPartInfo(parts[i]);
    if (!action) continue;
    if (action.status === "completed" || action.status === "failed") {
      terminalActionIds.add(action.actionCallId);
      continue;
    }
    if (
      action.status === "started" &&
      !terminalActionIds.has(action.actionCallId)
    ) {
      return action.actionName;
    }
  }
  return "";
}

function humanizeActionName(actionName: string): string {
  return actionName
    .replace(/Tool$/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function hasReasoning(parts: Array<Record<string, unknown>>) {
  return parts.some((part) => {
    if (part?.type !== "reasoning") return false;
    return getReasoningText(part).trim().length > 0;
  });
}

function hasAssistantText(parts: Array<Record<string, unknown>>) {
  return parts.some((part) => getPartText(part).trim().length > 0);
}

export function getContextActivityState(params: {
  context: ContextValue;
  isUploading: boolean;
}): ContextActivityState | null {
  const { context, isUploading } = params;
  const contextStatus = context.contextStatus;
  const executionStatus = context.context?.currentExecution?.status;
  const assistant = latestAssistantEvent(context);
  const runningStep = latestRunningStep(context);
  const assistantPending = assistant?.status === "pending";

  if (isUploading) {
    return {
      label: "Subiendo",
      animated: true,
      pattern: "outline",
      speed: 2.2,
      tone: "info",
    };
  }

  if (context.sendStatus === "error") {
    return {
      label: "No se envio",
      title: context.sendError ?? "Revisa la conexion e intenta de nuevo.",
      animated: false,
      pattern: "cross",
      speed: 1,
      tone: "error",
    };
  }

  if (context.sendStatus === "submitting" && contextStatus !== "open_streaming") {
    return {
      label: "Enviando",
      animated: true,
      pattern: "full",
      speed: 3,
      tone: "info",
    };
  }

  if (executionStatus === "failed" && assistantPending) {
    return {
      label: "Error",
      title: "El ultimo turno termino con error.",
      animated: false,
      pattern: "cross",
      speed: 1,
      tone: "error",
    };
  }

  if (contextStatus !== "open_streaming") return null;

  if (executionStatus === "executing" && !assistant) {
    return {
      label: "Iniciando",
      animated: true,
      pattern: "outline",
      speed: 1.4,
      tone: "info",
    };
  }

  if (!runningStep) {
    return {
      label: "Preparando",
      animated: true,
      pattern: "diamond",
      speed: 1.7,
      tone: "info",
    };
  }

  const parts = Array.isArray(runningStep.parts) ? runningStep.parts : [];
  const actionName = latestStartedActionName(parts);
  if (actionName) {
    return {
      label: "Trabajando",
      title: humanizeActionName(actionName),
      animated: true,
      pattern: "full",
      speed: 3.2,
      tone: "warning",
    };
  }

  if (hasReasoning(parts)) {
    return {
      label: "Pensando",
      animated: true,
      pattern: "rings",
      speed: 1.25,
      tone: "info",
    };
  }

  if (hasAssistantText(parts)) {
    return {
      label: "Respondiendo",
      animated: true,
      pattern: "full",
      speed: 2.4,
      tone: "info",
    };
  }

  return {
    label: "Preparando",
    animated: true,
    pattern: "diamond",
    speed: 1.6,
    tone: "neutral",
  };
}

export function ContextActivityIndicator({
  activity,
  density = "default",
}: {
  activity: ContextActivityState | null;
  density?: "default" | "compact";
}) {
  const [displayActivity, setDisplayActivity] =
    useState<ContextActivityState | null>(activity);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [loaderVersion, setLoaderVersion] = useState(0);
  const lastLiveActivityRef = useRef<ContextActivityState | null>(
    shouldPlayTerminalFinishing(activity) ? activity : null,
  );

  useEffect(() => {
    if (activity) {
      lastLiveActivityRef.current = shouldPlayTerminalFinishing(activity)
        ? activity
        : null;
      setIsFadingOut(false);
      setDisplayActivity(activity);
      return;
    }

    const previousActivity = lastLiveActivityRef.current;
    lastLiveActivityRef.current = null;

    if (shouldPlayTerminalFinishing(previousActivity)) {
      setIsFadingOut(false);
      setDisplayActivity(FINISHING_CONTEXT_ACTIVITY);
      setLoaderVersion((current) => current + 1);

      let idleTimeoutId: number | undefined;
      let fadeTimeoutId: number | undefined;
      const finishingTimeoutId = window.setTimeout(() => {
        setDisplayActivity(IDLE_CONTEXT_ACTIVITY);
        setLoaderVersion((current) => current + 1);
        idleTimeoutId = window.setTimeout(() => {
          setIsFadingOut(true);
          fadeTimeoutId = window.setTimeout(() => {
            setDisplayActivity(null);
            setIsFadingOut(false);
          }, ACTIVITY_FADE_OUT_MS);
        }, IDLE_AFTER_FINISH_MS);
      }, FINISHING_ANIMATION_MS);

      return () => {
        window.clearTimeout(finishingTimeoutId);
        if (idleTimeoutId !== undefined) {
          window.clearTimeout(idleTimeoutId);
        }
        if (fadeTimeoutId !== undefined) {
          window.clearTimeout(fadeTimeoutId);
        }
      };
    }

    setIsFadingOut(false);
    setDisplayActivity(null);
  }, [activity]);

  if (!displayActivity) return null;

  const toneClassName =
    displayActivity.tone === "error"
      ? "text-destructive"
      : displayActivity.tone === "warning"
        ? "text-amber-700 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div
      className={cn(
        "mx-auto mb-1.5 flex w-full max-w-3xl justify-start px-1 transition-[opacity,transform] duration-300 ease-out",
        density === "compact" && "max-w-none",
        isFadingOut && "-translate-x-3 opacity-0",
      )}
    >
      <TooltipProvider delayDuration={260}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              data-testid="context-activity-indicator"
              className={cn(
                "inline-flex h-5 items-center transition-colors",
                toneClassName,
              )}
            >
              <DotmSquare10
                key={loaderVersion}
                ariaLabel={displayActivity.label}
                animated={displayActivity.animated ?? true}
                pattern={displayActivity.pattern}
                speed={displayActivity.speed}
                size={density === "compact" ? 16 : 18}
                dotSize={2}
                cellPadding={density === "compact" ? 1.5 : 2}
                opacityBase={displayActivity.tone === "error" ? 0.2 : 0.1}
                opacityMid={displayActivity.tone === "error" ? 0.42 : 0.34}
                opacityPeak={displayActivity.tone === "error" ? 0.9 : 0.82}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {displayActivity.title ?? displayActivity.label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

type PromptBarProps = {
  context: ContextValue;
  density?: "default" | "compact";
  /** Static layout mock: disable input and send. */
  layoutMockReadOnly?: boolean;
  /** Render the activity indicator inside this prompt surface. */
  showActivity?: boolean;
};

const PromptBarInner = memo(function PromptBarInner({
  context,
  density = "default",
  layoutMockReadOnly = false,
  showActivity = true,
}: PromptBarProps) {
  const { db } = useOrgDb();
  const { append, contextId, sendStatus, stop } = context;

  const [input, setInput] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [reasoningLevel, setReasoningLevel] = useState<
    "off" | "low" | "medium" | "high"
  >("low");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const promptBridge = useAgentPromptBridge();

  useEffect(() => {
    if (!promptBridge) return;
    return promptBridge.subscribe((payload) => {
      setAttachments((prev) => {
        const withoutSameArtifact = prev.filter(
          (a) =>
            a.kind !== "artifact-context" ||
            a.artifactPayload?.kind !== payload.kind ||
            a.artifactPayload?.actionCallId !== payload.actionCallId,
        );
        return [
          ...withoutSameArtifact,
          {
            id: id(),
            name: payload.title,
            status: "done",
            kind: "artifact-context",
            artifactPayload: payload,
            size: "contexto",
            onPress: payload.actionCallId
              ? () => scrollToArtifactAnchor(payload.actionCallId)
              : undefined,
          },
        ];
      });
    });
  }, [promptBridge]);

  const isUploading = useMemo(
    () => attachments.some((att) => att.status === "uploading"),
    [attachments]
  );
  const fileParts = useMemo(
    () =>
      attachments
        .filter((att) => att.status === "done" && att.filePart)
        .map((att) => att.filePart as FileUIPart),
    [attachments]
  );

  const uploadAttachment = useCallback(
    async (file: File, attachmentId: string) => {
      try {
        if (!db) throw new Error("db not ready");

        const contextSegment = contextId ?? "unassigned";
        const sanitizedName = sanitizeFileName(file.name || "file");
        const storagePath = `/agent/${contextSegment}/${Date.now()}-${sanitizedName}`;

        const uploadResult = await db.storage.uploadFile(storagePath, file, {
          contentType: file.type || "application/octet-stream",
          contentDisposition: file.name,
        });

        const uploadRecord =
          uploadResult && typeof uploadResult === "object"
            ? (uploadResult as Record<string, unknown>)
            : null;
        const uploadData =
          uploadRecord && "data" in uploadRecord
            ? (uploadRecord.data as unknown)
            : uploadResult;
        const uploadDataRecord =
          uploadData && typeof uploadData === "object"
            ? (uploadData as Record<string, unknown>)
            : null;
        const fileId =
          uploadDataRecord && typeof uploadDataRecord.id === "string"
            ? uploadDataRecord.id
            : uploadDataRecord && typeof uploadDataRecord.id === "number"
              ? String(uploadDataRecord.id)
              : null;

        const downloadResult = await db.storage.getDownloadUrl(storagePath);
        const downloadUrl =
          typeof downloadResult === "string" ? downloadResult : downloadResult?.url;
        if (!downloadUrl) throw new Error("download url not returned");

        const filePart: FileUIPart = {
          type: "file",
          mediaType: file.type || "application/octet-stream",
          filename: file.name,
          url: downloadUrl,
        };

        const providerMetadata: Record<string, unknown> = {
          path: storagePath,
          downloadUrl,
          size: file.size,
        };
        if (fileId) providerMetadata.fileId = fileId;
        if (Object.keys(providerMetadata).length > 0) {
          filePart.providerMetadata = { instant: providerMetadata };
        }

        setAttachments((prev) =>
          prev.map((att) => {
            if (att.id !== attachmentId) return att;
            return {
              ...att,
              status: "done",
              url: downloadUrl,
              type: file.type || att.type,
              filePart,
              fileId: fileId ?? att.fileId,
              path: storagePath,
            };
          })
        );
      } catch (error) {
        console.error("Error uploading attachment", error);
        setAttachments((prev) =>
          prev.map((att) =>
            att.id === attachmentId ? { ...att, status: "error" } : att
          )
        );
      }
    },
    [contextId, db]
  );

  const onFilesSelected = useCallback(
    (files: FileSelection) => {
      if (!files || files.length === 0) return;
      const entries = Array.from(files).filter(Boolean);
      if (entries.length === 0) return;

      const prepared = entries.map((file) => {
        const attachmentId = id();
        return {
          attachment: {
            id: attachmentId,
            name: file.name,
            status: "uploading" as const,
            type: file.type || undefined,
            size: formatBytes(file.size),
          },
          file,
        };
      });

      setAttachments((prev) => [...prev, ...prepared.map((p) => p.attachment)]);
      prepared.forEach(({ file, attachment }) =>
        void uploadAttachment(file, attachment.id)
      );
    },
    [uploadAttachment]
  );

  const onRemoveAttachment = useCallback(
    (attachmentId: string) =>
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId)),
    []
  );
  const onClearAttachments = useCallback(() => setAttachments([]), []);

  const isContextStreaming = context.context?.status === "open_streaming";
  const isSubmitting = sendStatus === "submitting";

  const hasDoneAttachment = useMemo(
    () =>
      attachments.some(
        (a) =>
          a.status === "done" &&
          (Boolean(a.filePart) || a.kind === "artifact-context"),
      ),
    [attachments],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isUploading || isSubmitting || isContextStreaming) {
      return;
    }

    const parts: any[] = [];
    const trimmed = input.trim();
    if (trimmed) parts.push({ type: "text", text: trimmed });
    for (const att of attachments) {
      if (att.status !== "done") continue;
      if (att.kind === "artifact-context" && att.artifactPayload) {
        parts.push(buildArtifactContextFilePart(att.artifactPayload));
        continue;
      }
    }
    for (const fp of fileParts) parts.push(fp);
    if (parts.length === 0) return;

    const previousInput = input;
    try {
      setInput("");
      await append({ parts, webSearch, reasoningLevel });
      onClearAttachments();
    } catch (error) {
      setInput((current) => (current.length === 0 ? previousInput : current));
      console.error("Failed to send message", error);
    }
  };

  const promptStatus =
    isContextStreaming
      ? "streaming"
      : isSubmitting
        ? "submitted"
        : sendStatus === "error"
          ? "error"
          : "idle";
  const isBusy = isUploading || isSubmitting || isContextStreaming;
  const controlsDisabled = isBusy || layoutMockReadOnly;
  const activity = useMemo(
    () => getContextActivityState({ context, isUploading }),
    [context, isUploading],
  );

  return (
    <div>
      {showActivity ? (
        <ContextActivityIndicator activity={activity} density={density} />
      ) : null}
      <Prompt
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        webSearch={webSearch}
        onToggleWeb={() => setWebSearch(!webSearch)}
        reasoningLevel={reasoningLevel}
        onChangeReasoning={setReasoningLevel}
        status={promptStatus}
        onStop={stop}
        onFilesSelected={onFilesSelected}
        isUploading={isUploading}
        attachments={attachments}
        onRemoveAttachment={onRemoveAttachment}
        hasNonTextSendPayload={hasDoneAttachment}
        disabled={controlsDisabled}
        inputDisabled={layoutMockReadOnly}
        density={density}
        contextLabel={hasDoneAttachment ? "Contexto listo" : "Agente listo"}
      />
    </div>
  );
});

export function PromptBar(props: PromptBarProps) {
  return <PromptBarInner {...props} />;
}

"use client";

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { type ContextValue } from "@ekairos/events/react";
import { id } from "@instantdb/react";
import { Prompt } from "../../prompt/prompt";
import type { PromptAttachment } from "../../prompt/prompt-file-chip";
import { useOrgDb } from "@/lib/org-db-context";

import type { ArtifactPromptAttachmentPayload } from "../agent-prompt-bridge";
import { useAgentPromptBridge } from "../agent-prompt-bridge";
import {
  ContextActivityIndicator,
  getContextActivityState,
} from "./context-activity-indicator";

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

  const isContextStreaming = context.contextStatus === "running";
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

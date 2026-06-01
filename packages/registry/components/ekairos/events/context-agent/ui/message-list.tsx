"use client";

import React, { memo, useMemo, useState, type ReactNode } from "react";
import {
  INPUT_TEXT_ITEM_TYPE,
  type ContextEventForUI,
  type ContextValue,
} from "@ekairos/events/react";
import { cn } from "@/lib/utils";

import { MessageParts } from "./message-parts";
import { ContextStepList } from "./context-step-list";
import {
  getActionPartInfo,
  getCreateMessageText,
  getPartText,
  getReasoningText,
  normalizeContextEventParts,
} from "../context-event-parts";

import type { AgentClassNames } from "../types";

type MessageListProps = {
  context: ContextValue;
  actionComponents: Record<string, any>;
  classNames?: AgentClassNames;
  showReasoning: boolean;
  renderMessageActions?: (params: {
    message: any;
    status: "streaming" | "ready";
    isLatest: boolean;
  }) => ReactNode;
};

const MessageList = memo(function MessageList({
  context,
  actionComponents,
  classNames,
  showReasoning,
  renderMessageActions,
}: MessageListProps) {
  const { events, contextStatus, sendStatus } = context;

  const messages = useMemo(() => {
    const toMessage = (event: ContextEventForUI) => {
      const type = String(event?.type ?? "");
      const role =
        type === INPUT_TEXT_ITEM_TYPE || type === "input" || type.startsWith("user.")
          ? "user"
          : "assistant";
      return {
        id: event.id,
        role,
        parts: event.content?.parts || [],
        metadata: {
          channel: event.channel,
          type: event.type,
          createdAt: event.createdAt,
          eventId: event.id,
          status: event.status,
          emails: event.emails,
          whatsappMessages: event.whatsappMessages,
        },
        steps: event.steps ?? [],
      };
    };

    return events.map(toMessage).filter(hasRenderableMessage);
  }, [events]);

  const [visibleCount, setVisibleCount] = useState(100);
  const visibleMessages = useMemo(
    () => messages.slice(Math.max(0, messages.length - visibleCount)),
    [messages, visibleCount]
  );

  const shouldShowTurnIndicator =
    contextStatus === "open_streaming" || sendStatus === "submitting";
  const isTurnStreaming = shouldShowTurnIndicator;

  return (
    <div
      className={cn(
        "w-full max-w-3xl mx-auto space-y-6",
        classNames?.messageList
      )}
    >
      {messages.length > visibleCount && (
        <div className="flex justify-center">
          <button
            onClick={() => setVisibleCount((prev) => prev + 100)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Load older messages
          </button>
        </div>
      )}

      {visibleMessages.map((message: any) => {
        const isLatest = message === visibleMessages[visibleMessages.length - 1];
        const hasSteps =
          message.role === "assistant" &&
          Array.isArray(message.steps) &&
          message.steps.length > 0;
        const status =
          isLatest && isTurnStreaming && message?.role === "assistant"
            ? "streaming"
            : "ready";

        return (
          <div
            key={String(message?.id)}
            className={classNames?.message?.container}
          >
            <MessageHeader message={message} />
            {!hasSteps ? (
              <MessageParts
                message={message}
                status={status}
                isLatest={isLatest}
                actionComponents={actionComponents}
                classNames={classNames}
                showReasoning={showReasoning}
              />
            ) : null}
            {hasSteps ? (
              <ContextStepList
                steps={message.steps}
                actionComponents={actionComponents}
                classNames={classNames}
                showReasoning={showReasoning}
              />
            ) : null}
            {renderMessageActions
              ? renderMessageActions({ message, status, isLatest })
              : null}
          </div>
        );
      })}
    </div>
  );
});

export { MessageList };

function MessageHeader({ message }: { message: any }) {
  const metadata = message?.metadata ?? {};
  const chips = [
    { label: "event", value: shortIdentifier(metadata.eventId) },
    { label: "status", value: metadata.status },
    { label: "channel", value: metadata.channel },
  ].filter((chip) => typeof chip.value === "string" && chip.value.length > 0);

  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="text-[10px] font-semibold uppercase tracking-normal text-muted-foreground">
        {message?.role === "user" ? "User" : "Assistant"}
      </div>
      {chips.length > 0 ? (
        <div
          aria-label="Event metadata"
          className="flex min-w-0 flex-wrap justify-end gap-1"
        >
          {chips.map((chip) => (
            <span
              key={chip.label}
              className={cn(
                "inline-grid max-w-40 grid-cols-[auto_minmax(0,1fr)] overflow-hidden rounded-full",
                "border border-border/70 bg-muted/30 text-[10px] font-medium leading-none text-muted-foreground",
              )}
            >
              <b className="min-w-0 border-r border-border/60 px-1.5 py-1 uppercase text-muted-foreground/70">
                {chip.label}
              </b>
              <span className="min-w-0 truncate px-1.5 py-1 text-foreground/80">
                {chip.value}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function shortIdentifier(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length <= 12 ? text : text.slice(0, 8);
}

function hasRenderableMessage(message: any) {
  if (message.role === "user") {
    return Array.isArray(message.parts) && message.parts.length > 0;
  }

  if (hasVisibleAssistantParts(message.parts)) {
    return true;
  }

  const steps = Array.isArray(message.steps) ? message.steps : [];
  return steps.some((step: any) => hasVisibleAssistantParts(step?.parts));
}

function hasVisibleAssistantParts(parts: unknown[]): boolean {
  return normalizeContextEventParts(parts).some((part) => {
    if (part.type === "reasoning") {
      return getReasoningText(part).trim().length > 0;
    }
    if (
      part.type === "source" ||
      part.type === "source-url" ||
      part.type === "source-document" ||
      part.type === "file"
    ) {
      return false;
    }
    const action = getActionPartInfo(part);
    if (action) {
      return (
        action.actionName === "createMessage" &&
        getCreateMessageText(part).trim().length > 0
      );
    }
    return getPartText(part).trim().length > 0 || Boolean(part.type);
  });
}

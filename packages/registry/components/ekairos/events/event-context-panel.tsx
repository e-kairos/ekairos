"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  INPUT_TEXT_ITEM_TYPE,
  type AppendArgs,
  type ContextEventForUI,
  type ReasoningLevel,
  useContext,
} from "@ekairos/events/react";

export type EventContextPanelProps = {
  db: any;
  apiUrl: string;
  initialContextId?: string;
  contextKey?: string;
  onContextUpdate?: (contextId: string) => void;
  prepareAppendArgs?: (args: AppendArgs) => Promise<AppendArgs> | AppendArgs;
  prepareRequestBody?: (params: {
    messages: any[];
    webSearch?: boolean;
    reasoningLevel?: ReasoningLevel;
    contextId?: string;
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;
  className?: string;
  placeholder?: string;
  defaultPrompt?: string;
  webSearch?: boolean;
  reasoningLevel?: ReasoningLevel;
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function readEventText(event: ContextEventForUI) {
  const text = event.eventParts
    .map((part) => {
      if (typeof part.content === "string") return part.content;
      if (!part.content || typeof part.content !== "object") return "";
      const content = part.content as Record<string, unknown>;
      if (typeof content.text === "string") return content.text;
      if (Array.isArray(content.blocks)) {
        return content.blocks
          .map((block) => block && typeof block === "object" && typeof (block as any).text === "string"
            ? (block as any).text
            : "")
          .filter(Boolean)
          .join("\n");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  return text || event.type || event.id;
}

function getRole(event: ContextEventForUI) {
  const type = String(event.type ?? "");
  return type === INPUT_TEXT_ITEM_TYPE || type === "input" || type.startsWith("user.")
    ? "user"
    : "assistant";
}

export function EventContextPanel({
  db,
  apiUrl,
  initialContextId,
  contextKey,
  onContextUpdate,
  prepareAppendArgs,
  prepareRequestBody,
  className,
  placeholder = "Escribe el proximo mensaje del contexto...",
  defaultPrompt = "",
  webSearch,
  reasoningLevel,
}: EventContextPanelProps) {
  const [draft, setDraft] = useState(defaultPrompt);
  const context = useContext(db, {
    apiUrl,
    initialContextId,
    contextKey,
    onContextUpdate,
    prepareAppendArgs,
    prepareRequestBody,
  });

  const messages = useMemo(
    () =>
      context.events.map((event) => ({
        id: event.id,
        role: getRole(event),
        text: readEventText(event),
      })),
    [context.events]
  );

  const isSending = context.sendStatus === "submitting";
  const canSend = draft.trim().length > 0 && !isSending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;

    const text = draft.trim();
    setDraft("");
    await context.append({
      parts: [{ type: "text", text }],
      webSearch,
      reasoningLevel,
    });
  }

  return (
    <section
      className={cx(
        "flex h-full min-h-[520px] flex-col overflow-hidden border border-border bg-background text-foreground",
        className
      )}
    >
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Event context
            </p>
            <h2 className="mt-1 text-lg font-semibold">Live context panel</h2>
          </div>
          <span className="border border-border px-2.5 py-1 text-xs text-muted-foreground">
            {context.contextStatus}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No events yet.
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={cx(
                "max-w-[82%] border border-border px-3 py-2 text-sm leading-6",
                message.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-card text-card-foreground"
              )}
            >
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] opacity-70">
                {message.role}
              </div>
              <p className="whitespace-pre-wrap">{message.text}</p>
            </article>
          ))
        )}
      </div>

      {context.sendError ? (
        <p className="border-t border-border px-4 py-2 text-sm text-destructive">
          {context.sendError}
        </p>
      ) : null}

      <form className="border-t border-border p-3" onSubmit={submit}>
        <div className="flex gap-2">
          <textarea
            className="min-h-20 flex-1 resize-none border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
            placeholder={placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            disabled={!canSend}
            className="self-end bg-foreground px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSending ? "Sending" : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}

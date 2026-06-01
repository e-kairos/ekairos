"use client";

import { CirclePlayIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TemporalEvidenceItem = {
  href?: string | null;
  kind?: string;
  label: string;
  note?: string | null;
  sourceRef?: string | null;
  time?: number | null;
};

export type TemporalEvidenceListProps = {
  activeItemKey?: string | null;
  className?: string;
  emptyState?: ReactNode;
  getItemKey?: (item: TemporalEvidenceItem, index: number) => string;
  items: TemporalEvidenceItem[];
  maxItems?: number;
  onSelectItem?: (item: TemporalEvidenceItem, index: number) => void;
  title?: string;
};

export function TemporalEvidenceList({
  activeItemKey,
  className,
  emptyState = null,
  getItemKey,
  items,
  maxItems = 6,
  onSelectItem,
  title = "Evidence",
}: TemporalEvidenceListProps) {
  const visibleItems = items.slice(0, maxItems);
  if (visibleItems.length === 0) {
    return emptyState;
  }

  return (
    <details
      className={cn(
        "grid gap-1.5 rounded-md border border-border/70 bg-muted/20 p-1.5 text-sm",
        className
      )}
      open
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-1 text-[10px] font-semibold uppercase tracking-normal text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span className="text-[11px] normal-case text-muted-foreground/80">
          {formatTemporalEvidenceCount(visibleItems.length)}
        </span>
      </summary>
      <div className="grid gap-1">
        {visibleItems.map((item, index) => {
          const key =
            getItemKey?.(item, index) ??
            `${item.kind ?? "evidence"}:${item.label}:${item.time ?? index}`;
          const selected = activeItemKey === key;
          const className = cn(
            "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 border-l-2 px-1.5 py-1 text-inherit no-underline transition-colors",
            selected
              ? "border-foreground/70 bg-accent/50"
              : "border-border hover:border-foreground/50 hover:bg-accent/50"
          );
          const content = (
            <>
              <CirclePlayIcon className="mt-0.5 size-3 text-muted-foreground" />
              <span className="grid min-w-0 gap-0.5">
                <b className="truncate text-[11px] font-semibold text-foreground">
                  {[formatTemporalEvidenceTime(item.time), item.label]
                    .filter(Boolean)
                    .join(" - ")}
                </b>
                {item.note || item.sourceRef ? (
                  <small className="truncate text-[11px] leading-5 text-muted-foreground">
                    {item.note || item.sourceRef}
                  </small>
                ) : null}
              </span>
              {item.kind ? (
                <em className="text-[9px] font-semibold not-italic uppercase text-muted-foreground/70">
                  {item.kind}
                </em>
              ) : null}
            </>
          );

          return item.href ? (
            <a
              aria-current={selected ? "true" : undefined}
              className={className}
              href={item.href}
              key={key}
            >
              {content}
            </a>
          ) : onSelectItem ? (
            <button
              aria-pressed={selected}
              className={cn(className, "text-left")}
              key={key}
              onClick={() => onSelectItem(item, index)}
              type="button"
            >
              {content}
            </button>
          ) : (
            <div
              className={className}
              key={key}
            >
              {content}
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function formatTemporalEvidenceTime(value: TemporalEvidenceItem["time"]) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatTemporalEvidenceCount(count: number) {
  return `${count} cue${count === 1 ? "" : "s"}`;
}

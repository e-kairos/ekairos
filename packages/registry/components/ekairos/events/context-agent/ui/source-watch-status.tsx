"use client";

import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  Radio,
  Radar,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type SourceWatchPhase =
  | "checking"
  | "waiting"
  | "loading"
  | "loaded"
  | "empty"
  | "error";

export type SourceWatchStatusValue = {
  checkedAt?: Date | string | null;
  detail?: string;
  phase: SourceWatchPhase;
  pollIntervalMs?: number;
  sourceCount?: number;
  sourceLabel?: string | null;
  sourcePath?: string | null;
};

export type SourceWatchStatusLabels = Partial<Record<SourceWatchPhase, string>>;

export type SourceWatchStatusProps = {
  ariaLabelPrefix?: string;
  className?: string;
  labels?: SourceWatchStatusLabels;
  onOpen?: () => void;
  status: SourceWatchStatusValue;
};

export function SourceWatchStatus({
  ariaLabelPrefix = "Source watch",
  className,
  labels,
  onOpen,
  status,
}: SourceWatchStatusProps) {
  const Icon = iconForPhase(status.phase);
  const label = labels?.[status.phase] ?? labelForPhase(status.phase);
  const checkedAt = formatCheckedAt(status.checkedAt);
  const cadence = formatPollInterval(status.pollIntervalMs);
  const count = status.sourceCount ?? 0;
  const detail =
    status.sourceLabel || status.detail || status.sourcePath || "Watching source";
  const title = [
    status.sourcePath,
    status.detail,
    cadence ? `Polling every ${cadence}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const isBusy =
    status.phase === "checking" ||
    status.phase === "waiting" ||
    status.phase === "loading";
  const meta = [checkedAt, cadence].filter(Boolean).join(" / ");
  const checkedAtValue = serializeCheckedAt(status.checkedAt);
  const sharedDataAttrs = {
    "data-phase": status.phase,
    "data-poll-interval-ms": status.pollIntervalMs ?? undefined,
    "data-source-busy": isBusy ? "true" : "false",
    "data-source-checked-at": checkedAtValue || undefined,
    "data-source-count": count,
    "data-source-detail": detail,
    "data-source-has-open-action": onOpen ? "true" : "false",
    "data-source-label": status.sourceLabel || undefined,
    "data-source-path": status.sourcePath || undefined,
    "data-source-phase": status.phase,
    "data-source-watch-status": true,
  };

  const content = (
    <>
      <span
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500",
          status.phase === "waiting" && "text-amber-600",
          status.phase === "loaded" && "text-emerald-600",
          status.phase === "error" && "text-red-600",
          (status.phase === "checking" || status.phase === "loading") &&
            "text-sky-600 [&>svg]:animate-spin",
        )}
        aria-hidden="true"
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <b className="truncate text-[11px] font-semibold uppercase leading-none tracking-normal text-slate-800">
          {label}
        </b>
        <small className="truncate text-[11px] font-medium leading-none text-slate-500">
          {detail}
        </small>
      </span>
      <span className="ml-auto grid shrink-0 justify-items-end gap-0.5 text-[10px] font-medium uppercase leading-none text-slate-400">
        <span className="text-xs tabular-nums text-slate-700">{count}</span>
        {meta ? <small>{meta}</small> : null}
      </span>
    </>
  );

  const sharedClassName = cn(
    "grid h-10 min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-2.5 text-left shadow-none transition-colors",
    onOpen && "cursor-pointer hover:border-sky-200 hover:bg-sky-50/70",
    className,
  );

  if (onOpen) {
    return (
      <button
        aria-label={`${ariaLabelPrefix}: ${label}`}
        aria-busy={isBusy || undefined}
        className={sharedClassName}
        {...sharedDataAttrs}
        onClick={onOpen}
        title={title || undefined}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div
      aria-label={`${ariaLabelPrefix}: ${label}`}
      aria-busy={isBusy || undefined}
      className={sharedClassName}
      {...sharedDataAttrs}
      title={title || undefined}
    >
      {content}
    </div>
  );
}

function iconForPhase(phase: SourceWatchPhase): LucideIcon {
  if (phase === "checking" || phase === "loading") {
    return LoaderCircle;
  }
  if (phase === "loaded") {
    return CheckCircle2;
  }
  if (phase === "error") {
    return AlertTriangle;
  }
  if (phase === "waiting") {
    return Radar;
  }
  return Radio;
}

function labelForPhase(phase: SourceWatchPhase): string {
  if (phase === "checking") return "Scanning";
  if (phase === "waiting") return "Stabilizing";
  if (phase === "loading") return "Loading";
  if (phase === "loaded") return "Loaded";
  if (phase === "error") return "Source watch";
  return "Watching";
}

function formatCheckedAt(value: SourceWatchStatusValue["checkedAt"]): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function serializeCheckedAt(value: SourceWatchStatusValue["checkedAt"]): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function formatPollInterval(value: SourceWatchStatusValue["pollIntervalMs"]): string {
  if (!value || !Number.isFinite(value) || value <= 0) return "";
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) {
    return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
  }
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes.toFixed(0) : minutes.toFixed(1)}m`;
}

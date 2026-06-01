"use client";

import type { ComponentProps } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { VisualJsonValue } from "@/components/ekairos/tools/visual-json-value";
import { cn } from "@/lib/utils";

export type ActionPartState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export type ActionProps = ComponentProps<typeof Collapsible>;

export const Action = ({ className, ...props }: ActionProps) => (
  <Collapsible
    className={cn(
      "not-prose mb-2 w-full overflow-hidden rounded-md border border-border/70 bg-background transition-colors hover:border-border",
      className,
    )}
    {...props}
  />
);

export type ActionHeaderProps = {
  type: string;
  state: ActionPartState;
  className?: string;
  label?: string;
  summary?: string;
};

const getStatusLabel = (status: ActionPartState) => {
  const labels: Record<ActionPartState, string> = {
    "input-streaming": "Pendiente",
    "input-available": "Ejecutando",
    "output-available": "Completado",
    "output-error": "Error",
  };

  return labels[status] ?? "";
};

const getStatusClassName = (status: ActionPartState) => {
  if (status === "output-error") return "bg-destructive/10 text-destructive";
  if (status === "output-available") return "bg-emerald-50 text-emerald-700";
  return "bg-muted text-muted-foreground";
};

export const ActionHeader = ({
  className,
  type,
  state,
  label,
  summary,
  ...props
}: ActionHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/30",
      className,
    )}
    {...props}
  >
    <div className="min-w-0">
      <div className="truncate text-sm font-medium leading-5">
        {label || type}
      </div>
      {summary && summary.trim().length > 0 && (
        <div className="truncate text-xs leading-4 text-muted-foreground">
          {summary}
        </div>
      )}
    </div>
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        getStatusClassName(state),
      )}
    >
      {getStatusLabel(state)}
    </span>
  </CollapsibleTrigger>
);

export type ActionContentProps = ComponentProps<typeof CollapsibleContent>;

export const ActionContent = ({ className, ...props }: ActionContentProps) => (
  <CollapsibleContent
    className={cn(
      "border-t border-border/60 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2",
      className,
    )}
    {...props}
  />
);

export type ActionInputProps = ComponentProps<"div"> & {
  input: unknown;
};

export const ActionInput = ({ className, input, ...props }: ActionInputProps) => (
  <div className={cn("space-y-2 overflow-hidden p-3", className)} {...props}>
    <h4 className="text-xs font-medium uppercase text-muted-foreground">
      Detalles tecnicos (parametros)
    </h4>
    <VisualJsonValue value={input} height={220} />
  </div>
);

export type ActionOutputProps = ComponentProps<"div"> & {
  output?: unknown;
  errorText?: string;
};

export const ActionOutput = ({
  className,
  output,
  errorText,
  ...props
}: ActionOutputProps) => {
  if (output === undefined && !errorText) {
    return null;
  }

  return (
    <div className={cn("space-y-2 p-3", className)} {...props}>
      <h4 className="text-xs font-medium uppercase text-muted-foreground">
        {errorText ? "Error" : "Detalles tecnicos (resultado)"}
      </h4>
      {errorText ? (
        <div className="rounded bg-destructive/10 p-3 text-xs text-destructive">
          {errorText}
        </div>
      ) : (
        <VisualJsonValue value={output} height={260} />
      )}
    </div>
  );
};

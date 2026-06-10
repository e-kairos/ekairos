"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn-style live preview: the component rendered in a canvas, with its
 * source one tab away. Used across domain component docs.
 */
export function ComponentPreview({
  children,
  code,
  align = "center",
  minHeight = "16rem",
  className,
}: {
  children: ReactNode;
  code: string;
  align?: "center" | "start";
  minHeight?: string;
  className?: string;
}) {
  const [tab, setTab] = useState<"preview" | "code">("preview");

  return (
    <div className={cn("grid border border-border", className)}>
      <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2">
        {(["preview", "code"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "border-b-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
              tab === key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {key}
          </button>
        ))}
      </div>
      {tab === "preview" ? (
        <div
          className={cn(
            "grid w-full bg-background p-6 md:p-10",
            align === "center" ? "place-items-center" : "items-start",
          )}
          style={{ minHeight }}
        >
          <div className="w-full max-w-2xl">{children}</div>
        </div>
      ) : (
        <pre className="m-0 overflow-x-auto bg-muted/45 p-4 font-mono text-xs leading-6" style={{ minHeight }}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

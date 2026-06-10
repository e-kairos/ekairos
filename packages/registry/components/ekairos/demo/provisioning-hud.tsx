"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { DemoSteps, DemoStepState } from "@/lib/demo/demo-experience";

const SKY = "#75AADB";
const GOLD = "#D4AF37";

const STEP_ORDER: Array<{ key: keyof DemoSteps; label: string; detail: string }> = [
  { key: "database", label: "database", detail: "temporary InstantDB app" },
  { key: "schema", label: "domain schema", detail: "entities & links pushed" },
  { key: "data", label: "demo data", detail: "page records seeded" },
];

function stateWord(state: DemoStepState): string {
  switch (state) {
    case "active":
      return "provisioning";
    case "done":
      return "ready";
    case "error":
      return "failed";
    default:
      return "queued";
  }
}

/**
 * Shared provisioning HUD for the registry demo lifecycle: one temporary
 * database per visit, one schema per domain, one seed per page. Sky blue,
 * white and a restrained gold; in-flight states shimmer iridescent.
 */
export function DemoProvisioningHud({
  steps,
  appId,
  error,
  onRetry,
  className,
}: {
  steps: DemoSteps;
  appId?: string | null;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  const allDone = STEP_ORDER.every(({ key }) => steps[key] === "done");

  return (
    <section
      aria-label="Demo provisioning"
      className={cn("border border-white/15 bg-[#04070a] text-[#eaf2f7]", className)}
    >
      <div className="ek-tornasol h-[2px] w-full" style={{ opacity: allDone ? 0.45 : 1 }} />
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 px-4 py-2.5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.26em]" style={{ color: SKY }}>
          temporal instantdb
          <span className="mx-2 inline-block h-1 w-1 rounded-full align-middle" style={{ backgroundColor: GOLD }} />
          <span className="text-white/55">live demo runtime</span>
        </p>
        {appId ? (
          <p className="font-mono text-[10px] tracking-[0.08em] text-white/35">
            db {appId.slice(0, 8)}… · self-expiring
          </p>
        ) : null}
      </div>

      <ol className="grid md:grid-cols-3">
        {STEP_ORDER.map(({ key, label, detail }, index) => {
          const state = steps[key];
          return (
            <li
              key={key}
              className={cn(
                "grid gap-1 border-b border-white/10 px-4 py-3 md:border-b-0 md:border-r md:last:border-r-0",
                state === "pending" && "opacity-45",
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "font-mono text-xs font-bold tabular-nums",
                    state === "active" && "ek-tornasol-text",
                  )}
                  style={
                    state === "done"
                      ? { color: GOLD }
                      : state === "error"
                        ? { color: "#ff5c67" }
                        : state === "active"
                          ? undefined
                          : { color: "rgba(255,255,255,0.5)" }
                  }
                >
                  0{index + 1}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white">
                  {label}
                </span>
                <span
                  className={cn(
                    "ml-auto font-mono text-[10px] uppercase tracking-[0.14em]",
                    state === "active" && "ek-tornasol-text",
                  )}
                  style={
                    state === "done"
                      ? { color: SKY }
                      : state === "error"
                        ? { color: "#ff5c67" }
                        : state === "active"
                          ? undefined
                          : { color: "rgba(255,255,255,0.4)" }
                  }
                >
                  {stateWord(state)}
                </span>
              </div>
              <p className="pl-[26px] text-[11px] leading-5 text-white/45">{detail}</p>
              <div className="ml-[26px] mt-0.5 h-px w-full max-w-[10rem] overflow-hidden bg-white/10">
                {state === "active" ? <div className="ek-tornasol h-full w-full" /> : null}
                {state === "done" ? (
                  <div className="h-full w-full" style={{ backgroundColor: GOLD, opacity: 0.7 }} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {error ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#ff8a93]">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="border border-white/25 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white transition-colors hover:border-white"
            >
              retry
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Compact floating variant: a quiet pill at the bottom-right while a step is
 * in flight, a gold tick once everything is ready, gone shortly after.
 */
export function DemoProvisioningChip({
  steps,
  appId,
}: {
  steps: DemoSteps;
  appId?: string | null;
}) {
  const allDone = STEP_ORDER.every(({ key }) => steps[key] === "done");
  const failed = STEP_ORDER.some(({ key }) => steps[key] === "error");
  const active = STEP_ORDER.find(({ key }) => steps[key] === "active");
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!allDone) {
      setHidden(false);
      return;
    }
    const timer = setTimeout(() => setHidden(true), 2600);
    return () => clearTimeout(timer);
  }, [allDone]);

  if (hidden || (allDone && !appId)) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80]">
      <div className="border border-white/15 bg-[#04070a]/95 backdrop-blur-sm">
        <div className="ek-tornasol h-[1.5px] w-full" style={{ opacity: allDone ? 0.4 : 1 }} />
        <div className="flex items-center gap-2.5 px-3 py-2">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: failed ? "#ff5c67" : allDone ? GOLD : SKY }}
          />
          <span
            className={cn(
              "font-mono text-[10px] uppercase tracking-[0.2em]",
              active && "ek-tornasol-text",
            )}
            style={active ? undefined : { color: allDone ? GOLD : "rgba(255,255,255,0.7)" }}
          >
            {failed
              ? "demo runtime failed"
              : allDone
                ? "demo runtime ready"
                : `${active?.label ?? "database"}…`}
          </span>
        </div>
      </div>
    </div>
  );
}

"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type CopyState = "idle" | "copied" | "error"

const RESET_DELAY_MS = 2_000

export function CodeCopyButton({
  code,
  hasCaption,
}: {
  code: string
  hasCaption: boolean
}) {
  const [state, setState] = useState<CopyState>("idle")
  const resetTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    }
  }, [])

  const scheduleReset = () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setState("idle"), RESET_DELAY_MS)
  }

  const copyCode = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable")
      await navigator.clipboard.writeText(code)
      setState("copied")
    } catch {
      setState("error")
    }

    scheduleReset()
  }

  const label = state === "copied"
    ? "Code copied"
    : state === "error"
      ? "Copy failed"
      : "Copy code"
  const Icon = state === "copied" ? Check : Copy

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            data-copy-state={state}
            onClick={copyCode}
            className={cn(
              "absolute right-2 z-10 inline-flex size-7 items-center justify-center rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-1",
              hasCaption
                ? "top-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-offset-background"
                : "top-2 border border-neutral-700/80 bg-neutral-950/90 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:ring-offset-neutral-950",
              state === "copied" && "text-cyan-600 dark:text-cyan-400",
              state === "error" && "text-amber-600 dark:text-amber-400",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "idle" ? "" : label}
      </span>
    </TooltipProvider>
  )
}

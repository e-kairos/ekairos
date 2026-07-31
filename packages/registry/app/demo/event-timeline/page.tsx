"use client"

import { type CSSProperties, useState } from "react"

import { EventTimelineView } from "@/components/ekairos/reactions/event-timeline"
import { eventTimelineFixture } from "./fixture"

const demoTheme = {
  "--event-timeline-surface": "#030405",
  "--event-timeline-panel": "#07090a",
  "--event-timeline-line": "rgba(255, 255, 255, 0.1)",
  "--event-timeline-accent": "#7defff",
  "--event-timeline-type": "#9be7f4",
} as CSSProperties

export default function EventTimelineDemoPage() {
  const [selectedId, setSelectedId] = useState<string | null>("reaction-answer")

  return (
    <main className="min-h-screen bg-black px-5 py-12 text-white md:px-12">
      <div className="mx-auto grid w-full max-w-5xl gap-8">
        <header className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-cyan-300">
            Registry fixture
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-6xl">
            Event timeline
          </h1>
          <p className="mt-4 text-sm leading-6 text-white/60">
            A deterministic Context Session fixture exercising fan-out, parallel lanes,
            convergence, selection, and causal edges.
          </p>
        </header>

        <section
          className="h-[430px] min-w-0 overflow-hidden border border-white/10 bg-[#030405]"
          style={demoTheme}
        >
          <EventTimelineView
            onSelect={setSelectedId}
            selectedId={selectedId}
            session={eventTimelineFixture}
          />
        </section>

        <footer className="flex items-center justify-between border-t border-white/10 pt-4 font-mono text-xs text-white/45">
          <span>Selected reaction</span>
          <code className="text-cyan-200">{selectedId ?? "none"}</code>
        </footer>
      </div>
    </main>
  )
}

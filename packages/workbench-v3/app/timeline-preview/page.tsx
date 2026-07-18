"use client"

// Dev-only fixture page to iterate the causal timeline without running a
// real Reaction. Not linked from the app.
import type {
  ContextEventForUI,
  ContextReactionForUI,
  ContextSessionForUI,
} from "@ekairos/events/react"
import { useState } from "react"

import { EventTimelineView, JsonView } from "@/src/components/workbench"

function event(
  id: string,
  type: string,
  createdAt: string,
  payload: unknown = {},
  durability: ContextEventForUI["durability"] = "durable",
): ContextEventForUI {
  return {
    id,
    type,
    createdAt,
    payload,
    links: {},
    metadata: {},
    eventParts: [],
    durability,
  }
}

function reaction(input: {
  id: string
  type: string
  position: number
  causes: ContextEventForUI[]
  effects: ContextEventForUI[]
  status?: ContextReactionForUI["status"]
  instruction?: string
  parent?: ContextReactionForUI | null
}): ContextReactionForUI {
  return {
    id: input.id,
    type: input.type,
    status: input.status ?? "completed",
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:04.200Z",
    position: input.position,
    depth: input.position === 0 ? 0 : 1,
    causeIds: input.causes.map(row => row.id),
    effectIds: input.effects.map(row => row.id),
    ...(input.instruction ? { instruction: input.instruction } : {}),
    causes: input.causes,
    effects: input.effects,
    stream: null,
    liveEffects: [],
    parent: input.parent ? { id: input.parent.id, type: input.parent.type } : null,
  }
}

const trigger = event("trigger", "workbench.messageReceived", "2026-07-17T12:00:00.000Z", {
  text: "Revisar esta solicitud de compra: 12 notebooks empresariales...",
})
const cloned = event("cloned", "context.git.clone", "2026-07-17T12:00:01.000Z", {
  repository: "github.com/ekairos/workbench-fixtures",
})
const loaded = event("loaded", "context.loadFiles", "2026-07-17T12:00:01.200Z", {
  files: [{ name: "request.pdf" }, { name: "vendors.csv" }],
})
const dataset = event("dataset", "context.dataset", "2026-07-17T12:00:02.000Z", {
  records: [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}],
})
const analysis = event("analysis", "context.action", "2026-07-17T12:00:02.300Z", { summary: "budget analysis completed" })
const shellRun = event("shell-run", "context.shell", "2026-07-17T12:00:02.600Z", {
  command: "python analyze.py --input request.pdf --budget 45000",
})
const decision = event("decision", "context.model", "2026-07-17T12:00:03.000Z", { summary: "Approve with two observations on delivery time" })
const requested = event("verify-requested", "workbench.reviewVerificationRequested", "2026-07-17T12:00:03.400Z", { summary: "verification requested" })
const childModel = event("child-model", "context.model", "2026-07-17T12:00:03.800Z", { summary: "review verified against dataset" }, "streaming")
const verified = event("verified", "workbench.reviewVerificationCompleted", "2026-07-17T12:00:04.100Z", { summary: "verification passed" })
const completed = event("completed", "workbench.reviewCompleted", "2026-07-17T12:00:04.500Z", { summary: "workbench-review.md published" }, "optimistic")

const root = reaction({ id: "root", type: "workbench.review-request", position: 0, causes: [trigger], effects: [completed] })
const clone = reaction({ id: "clone", type: "action", position: 1, causes: [trigger], effects: [cloned] })
const load = reaction({ id: "load", type: "action", position: 2, causes: [trigger], effects: [loaded] })
const materialize = reaction({ id: "materialize", type: "dataset", position: 3, causes: [loaded], effects: [dataset] })
const analyze = reaction({ id: "analyze", type: "action", position: 4, causes: [cloned, loaded], effects: [shellRun, analysis] })
const decide = reaction({
  id: "decide",
  type: "agent",
  position: 5,
  causes: [dataset, analysis],
  effects: [decision, requested],
  instruction: "Decide whether the purchase request should be approved.",
})
const childRoot = reaction({ id: "child-root", type: "workbench.verify-recorded-review", position: 0, causes: [requested], effects: [verified], parent: decide })
const childAgent = reaction({
  id: "child-agent",
  type: "agent",
  position: 1,
  causes: [requested],
  effects: [childModel],
  status: "running",
  instruction: "Verify the recorded review.",
  parent: childRoot,
})
const childEmit = reaction({ id: "child-emit", type: "emit", position: 2, causes: [childModel], effects: [verified], parent: childRoot })
const emit = reaction({ id: "emit", type: "emit", position: 6, causes: [decision, verified], effects: [completed] })

const childSession: ContextSessionForUI = {
  id: "child-session",
  definition: "workbench.verify-recorded-review",
  status: "running",
  parentSessionId: "session",
  parentReactionId: "decide",
  createdAt: "2026-07-17T12:00:03.400Z",
  trigger: requested,
  rootReaction: childRoot,
  reactions: [childRoot, childAgent, childEmit],
  children: [],
}

const session: ContextSessionForUI = {
  id: "session",
  definition: "workbench.review-request",
  status: "running",
  createdAt: "2026-07-17T12:00:00.000Z",
  trigger,
  rootReaction: root,
  reactions: [root, clone, load, materialize, analyze, decide, emit],
  children: [childSession],
}

const chatOmit = new Set([trigger.id, completed.id])

export default function TimelinePreview() {
  const [selectedId, setSelectedId] = useState<string | null>("decide")
  return (
    <main style={{ display: "flex", gap: 24, alignItems: "flex-start", justifyContent: "center", minHeight: "100vh", paddingTop: 40 }}>
      <div style={{ width: 620, height: 600, overflow: "hidden", border: "1px solid #23282a", background: "#101213" }}>
        <EventTimelineView
          session={session}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div style={{ display: "grid", gap: 24 }}>
        <div style={{ width: 620, overflow: "hidden", border: "1px solid #23282a", background: "#101213" }}>
          <EventTimelineView
            omit={chatOmit}
            session={session}
            selectedId={selectedId}
            onSelect={setSelectedId}
            variant="chat"
          />
        </div>
        <div style={{ width: 620, padding: 12, border: "1px solid #23282a", background: "#101213" }}>
          <JsonView
            value={{
              actionName: "workbench.recordReview",
              status: "completed",
              input: {
                reviewId: "rev_8f3a2c",
                itemCount: 12,
                budget: 45000,
                approved: true,
                items: [
                  { description: "Notebook empresarial 14\"", quantity: 12, unit: "unidad" },
                  { description: "Monitor 27\"", quantity: 24, unit: "unidad" },
                ],
                notes: null,
              },
              output: {
                markdown: "## Revisión de la solicitud\n\n**Ítems extraídos: 3**\n\n1. 12 notebooks empresariales de 14 pulgadas\n2. 24 monitores de 27 pulgadas\n3. 12 docking stations USB-C\n\nLa compra se aprueba con dos observaciones sobre el plazo de entrega y la garantía extendida solicitada al proveedor.",
              },
            }}
          />
        </div>
      </div>
    </main>
  )
}

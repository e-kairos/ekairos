import type {
  ContextEventForUI,
  ContextReactionForUI,
  ContextSessionForUI,
} from "@ekairos/events/react"

function event(
  id: string,
  type: string,
  createdAt: string,
  text: string,
): ContextEventForUI {
  return {
    id,
    type,
    createdAt,
    payload: { text },
    links: {},
    metadata: {},
    eventParts: [{
      id: `${id}:message`,
      key: `${id}:message`,
      index: 0,
      type: "message",
      content: { text },
      createdAt,
    }],
    durability: "durable",
  }
}

function reaction(input: {
  id: string
  type: string
  position: number
  causes: ContextEventForUI[]
  effects: ContextEventForUI[]
  createdAt: string
  updatedAt: string
  instruction?: string
}): ContextReactionForUI {
  return {
    id: input.id,
    type: input.type,
    status: "completed",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    position: input.position,
    depth: 1,
    causeIds: input.causes.map(item => item.id),
    effectIds: input.effects.map(item => item.id),
    causes: input.causes,
    effects: input.effects,
    stream: null,
    liveEffects: [],
    instruction: input.instruction,
    parent: { id: "reaction-root", type: "root" },
  }
}

const trigger = event(
  "event-trigger",
  "user.message",
  "2026-07-31T13:00:00.000Z",
  "Inspect the release candidate and summarize the evidence.",
)
const plan = event(
  "event-plan",
  "context.plan",
  "2026-07-31T13:00:01.000Z",
  "Split verification into schema and runtime branches.",
)
const schema = event(
  "event-schema",
  "domain.schema.verified",
  "2026-07-31T13:00:03.000Z",
  "Schema plan is idempotent across the organization matrix.",
)
const runtime = event(
  "event-runtime",
  "runtime.smoke.completed",
  "2026-07-31T13:00:04.000Z",
  "Runtime resolved every scoped admin connection.",
)
const answer = event(
  "event-answer",
  "assistant.message",
  "2026-07-31T13:00:06.000Z",
  "Release candidate verified. Schema and runtime evidence converge.",
)

const planReaction = reaction({
  id: "reaction-plan",
  type: "agent",
  position: 1,
  causes: [trigger],
  effects: [plan],
  createdAt: "2026-07-31T13:00:00.400Z",
  updatedAt: "2026-07-31T13:00:01.000Z",
  instruction: "Plan the verification work.",
})
const schemaReaction = reaction({
  id: "reaction-schema",
  type: "action",
  position: 2,
  causes: [plan],
  effects: [schema],
  createdAt: "2026-07-31T13:00:01.200Z",
  updatedAt: "2026-07-31T13:00:03.000Z",
  instruction: "Verify the schema plan.",
})
const runtimeReaction = reaction({
  id: "reaction-runtime",
  type: "action",
  position: 3,
  causes: [plan],
  effects: [runtime],
  createdAt: "2026-07-31T13:00:01.300Z",
  updatedAt: "2026-07-31T13:00:04.000Z",
  instruction: "Run the runtime smoke matrix.",
})
const answerReaction = reaction({
  id: "reaction-answer",
  type: "agent",
  position: 4,
  causes: [schema, runtime],
  effects: [answer],
  createdAt: "2026-07-31T13:00:04.200Z",
  updatedAt: "2026-07-31T13:00:06.000Z",
  instruction: "Join the evidence and write the answer.",
})
const rootReaction: ContextReactionForUI = {
  id: "reaction-root",
  type: "root",
  status: "completed",
  createdAt: trigger.createdAt,
  updatedAt: answer.createdAt,
  position: 0,
  depth: 0,
  causeIds: [trigger.id],
  effectIds: [answer.id],
  causes: [trigger],
  effects: [answer],
  stream: null,
  liveEffects: [],
  parent: null,
}

export const eventTimelineFixture: ContextSessionForUI = {
  id: "session-release-verification",
  definition: "registry.release.verify",
  status: "completed",
  createdAt: trigger.createdAt,
  updatedAt: answer.createdAt,
  trigger,
  rootReaction,
  reactions: [
    rootReaction,
    planReaction,
    schemaReaction,
    runtimeReaction,
    answerReaction,
  ],
  children: [],
}

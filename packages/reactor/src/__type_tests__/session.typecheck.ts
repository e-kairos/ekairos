import { z } from "zod"

import {
  defineDomainAction,
  defineEvent,
  domain,
} from "@ekairos/domain"
import { ContextHandle, type ContextEvent } from "@ekairos/events"
import * as reactorSurface from "../index.js"
import type { ReactorPath } from "../workspace-path.js"
import { Session } from "../session.js"

const saveAnswer = defineDomainAction({
  input: z.object({ conversationId: z.string(), answer: z.string() }),
  output: z.object({ id: z.string() }),
  async execute({ input }) {
    return { id: `${input.conversationId}:${input.answer}` }
  },
})
const conversation = domain("conversation")
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({
    messageReceived: defineEvent({
      payload: z.object({ message: z.string() }),
    }),
    conversationClosed: defineEvent({
      payload: z.object({ reason: z.string() }),
    }),
  })
  .withActions({
    saveAnswer,
    closeConversation: defineDomainAction({
      input: z.object({ reason: z.string() }),
      output: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    }),
  })
const coaching = conversation.scope({
  events: [conversation.events.messageReceived],
  actions: [conversation.actions.saveAnswer],
})
const runtime = null as any
const context = null as unknown as ContextHandle<{ policy: string }>
const source = null as unknown as ContextEvent<{ message: string }>

const session = new Session(runtime, context, {
  scope: coaching,
  engine: false,
  sandbox: false,
})

new Session(runtime, context, {
  scope: conversation,
  engine: false,
  // @ts-expect-error actions are exposed explicitly by each agent operation
  actions: [conversation.actions.saveAnswer],
})

const answer = await session.from(source).agent({
  instruction: "Answer.",
  output: z.object({ answer: z.string() }),
})
answer.payload.answer satisfies string
const checked: ContextEvent<{ answer: string }> = answer

await session.from(conversation.events.messageReceived({ message: "hello" })).agent({
  instruction: "Answer.",
})
// @ts-expect-error draft event is outside the concrete scope
session.from(conversation.events.conversationClosed({ reason: "done" }))

const files = await session.from(checked).loadFiles()
files.payload.path satisfies ReactorPath
files.payload.files[0]?.path satisfies ReactorPath | undefined

const repository = await session.from(checked).git({
  operation: "clone",
  key: "platform",
  url: "https://example.test/platform.git",
})
repository.payload.path satisfies ReactorPath
const inspected = await session.from(repository).shell({
  command: "git",
  args: ["status", "--short"],
  path: repository.payload.path,
})
const stored = await session.from(inspected).storeFiles({
  path: repository.payload.path,
  files: "review.md",
})
stored.payload.files[0]?.fileId satisfies string | undefined
await session.from(stored).git({
  operation: "commit",
  path: repository.payload.path,
  message: "Record review",
})

const saved = await session.from(checked).action(
  conversation.actions.saveAnswer.scope({ conversationId: "conversation-1" }),
  { answer: checked.payload.answer },
)
saved.payload.id satisfies string

await session.from(checked).agent({
  instruction: "Persist the answer.",
  output: z.object({ answer: z.string() }),
  actions: [
    conversation.actions.saveAnswer.scope({ conversationId: "conversation-1" }),
  ],
})

await session.from(checked).agent({
  instruction: "Invalid scoped action.",
  // @ts-expect-error action is outside the concrete scope
  actions: [conversation.actions.closeConversation],
})

await session.from(checked).agent({
  instruction: "Invalid.",
  output: z.object({ answer: z.string() }),
  // @ts-expect-error arbitrary callback tools are not domain actions
  actions: [async () => ({ id: "invalid" })],
})

await session.from(checked).agent({
  instruction: "Invalid override.",
  // @ts-expect-error repair policy belongs to the configured engine
  repairRetries: 1,
})

// @ts-expect-error from receives one Event or one Event array
session.from(source, answer)
// @ts-expect-error compute is not a Session operation
session.from(answer).compute({ instruction: "No." })
// @ts-expect-error emit is not a Session operation
session.from(answer).emit({})
// @ts-expect-error shell uses a typed logical path, never cwd
session.from(answer).shell({ command: "pwd", cwd: "." })
// @ts-expect-error workspace was replaced by loadFiles/storeFiles
session.from(answer).workspace({ files: ["file-1"] })

await session.complete()

// @ts-expect-error Point/join is not part of the root API
reactorSurface.join

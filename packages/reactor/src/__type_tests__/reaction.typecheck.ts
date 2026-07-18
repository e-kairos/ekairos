import { z } from "zod"

import {
  defineDomainAction,
  defineEvent,
  domain,
} from "@ekairos/domain"
import type { ContextEvent } from "@ekairos/events"
import * as reactorSurface from "../index.js"
import type { ReactorPath } from "../workspace-path.js"
import { defineReaction } from "../reaction.js"

const messageReceived = defineEvent({
  payload: z.object({ message: z.string() }),
})
const messageAnswered = defineEvent({
  payload: z.object({ answer: z.string() }),
})
const saveAnswer = defineDomainAction({
  input: z.object({ conversationId: z.string(), answer: z.string() }),
  output: z.object({ id: z.string() }),
  async execute({ input }) {
    return { id: `${input.conversationId}:${input.answer}` }
  },
})
const conversation = domain("conversation")
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withEvents({ messageReceived, messageAnswered })
  .withActions({ saveAnswer })

defineReaction(
  conversation.events.messageReceived,
  {
    key: "conversation.answer",
    scope: conversation,
    engine: false,
    sandbox: false,
  },
  async reaction => {
    reaction.trigger.payload.message satisfies string
    const answer = await reaction.given(reaction.trigger).agent({
      instruction: "Answer.",
      output: z.object({ answer: z.string() }),
    })
    answer.payload.answer satisfies string
    const checked: ContextEvent<{ answer: string }> = answer

    const files = await reaction.given(checked).loadFiles()
    files.payload.path satisfies ReactorPath
    files.payload.files[0]?.path satisfies ReactorPath | undefined

    const repository = await reaction.given(checked).git({
      operation: "clone",
      key: "platform",
      url: "https://example.test/platform.git",
    })
    repository.payload.path satisfies ReactorPath
    const inspected = await reaction.given(repository).shell({
      command: "git",
      args: ["status", "--short"],
      path: repository.payload.path,
    })
    const stored = await reaction.given(inspected).storeFiles({
      path: repository.payload.path,
      files: "review.md",
    })
    stored.payload.files[0]?.fileId satisfies string | undefined
    await reaction.given(stored).git({
      operation: "commit",
      path: repository.payload.path,
      message: "Record review",
    })

    const saved = await reaction.given(checked).action(
      conversation.actions.saveAnswer.scope({ conversationId: "conversation-1" }),
      { answer: checked.payload.answer },
    )
    saved.payload.id satisfies string

    await reaction.given(checked).agent({
      instruction: "Persist the answer.",
      output: z.object({ answer: z.string() }),
      actions: [
        conversation.actions.saveAnswer.scope({ conversationId: "conversation-1" }),
      ],
    })

    await reaction.given(checked).agent({
      instruction: "Invalid.",
      output: z.object({ answer: z.string() }),
      // @ts-expect-error arbitrary callback tools are not domain actions
      actions: [async () => ({ id: "invalid" })],
    })

    // @ts-expect-error given receives one Event or one Event array
    reaction.given(reaction.trigger, answer)
    // @ts-expect-error compute was removed; agent is the only model primitive
    reaction.given(answer).compute({ instruction: "No." })
    // @ts-expect-error effect was renamed to emit
    reaction.given(answer).effect(conversation.events.messageAnswered({ answer: "No." }))
    // @ts-expect-error shell uses a typed logical path, never cwd
    reaction.given(answer).shell({ command: "pwd", cwd: "." })
    // @ts-expect-error workspace was replaced by loadFiles/storeFiles
    reaction.given(answer).workspace({ files: ["file-1"] })

    return await reaction.given(saved).emit(
      conversation.events.messageAnswered({ answer: checked.payload.answer }),
    )
  },
)

// @ts-expect-error Point/join was removed from the root API
reactorSurface.join

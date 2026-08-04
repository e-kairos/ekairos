import { randomUUID } from "node:crypto"

import type { ReactionChatInput } from "../contract.ts"

export async function react(input: ReactionChatInput) {
  const createdAt = new Date()
  const text = `Echo [${input.contextKey}]: ${JSON.stringify(input.input)}`

  const event = Object.freeze({
    id: randomUUID(),
    type: "reactionChat.echo.completed",
    createdAt,
    payload: Object.freeze({ text }),
    links: Object.freeze({}),
    physicalLinks: Object.freeze({}),
    metadata: Object.freeze({ example: true }),
    eventParts: Object.freeze([Object.freeze({
      id: randomUUID(),
      key: "message:0",
      index: 0,
      type: "message",
      content: Object.freeze({ text }),
      createdAt,
    })]),
  })
  return Object.freeze({
    contextId: `echo:${input.contextKey}`,
    sessionId: randomUUID(),
    returnValue: Promise.resolve(event),
  })
}

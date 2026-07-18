import type { ContextEvent } from "@ekairos/events"
import { describe, expect, it } from "vitest"

import { collectEventFileReferences } from "../reaction-files.js"

function event(
  id: string,
  links: ContextEvent["links"],
  aliases: Record<string, string>,
): ContextEvent {
  return {
    id,
    type: `test.${id}`,
    createdAt: new Date("2026-07-17T12:00:00.000Z"),
    payload: {},
    links,
    physicalLinks: Object.freeze(Object.fromEntries(Object.entries(aliases).map(([alias, target]) => [
      alias,
      {
        alias,
        key: `event__test__${alias}`,
        target,
        has: Array.isArray(links[alias]) ? "many" : "one",
        forwardLabel: `test_${alias}`,
        reverseLabel: `test_events_as_${alias}`,
      },
    ]))),
    metadata: {},
    eventParts: [],
  }
}

describe("Event file references", () => {
  it("deduplicates physical files while preserving every Event origin", () => {
    const references = collectEventFileReferences([
      event("first", { attachments: ["file-1", "file-2"] }, { attachments: "$files" }),
      event("second", { source: "file-1", owner: "person-1" }, {
        source: "$files",
        owner: "people",
      }),
    ])

    expect(references).toEqual([
      {
        fileId: "file-1",
        origins: [
          { eventId: "first", eventType: "test.first", link: "attachments" },
          { eventId: "second", eventType: "test.second", link: "source" },
        ],
      },
      {
        fileId: "file-2",
        origins: [
          { eventId: "first", eventType: "test.first", link: "attachments" },
        ],
      },
    ])
  })
})

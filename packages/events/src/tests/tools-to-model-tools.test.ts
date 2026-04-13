import { describe, expect, it } from "vitest"
import { openai } from "@ai-sdk/openai"

import {
  actionsToActionSpecs,
  actionSpecToAiSdkTool,
} from "../tools-to-model-tools"

describe("actionsToActionSpecs", () => {
  it("preserves provider-defined AI SDK tools for the reactor step", () => {
    const specs = actionsToActionSpecs({
      web_search: openai.tools.webSearch({
        searchContextSize: "medium",
      }) as any,
    })

    expect(specs.web_search).toEqual({
      type: "provider-defined",
      id: "openai.web_search",
      name: "web_search",
      args: {
        searchContextSize: "medium",
      },
    })

    expect(
      actionSpecToAiSdkTool("web_search", specs.web_search!, (schema) => ({
        wrapped: schema,
      })),
    ).toEqual({
      type: "provider-defined",
      id: "openai.web_search",
      name: "web_search",
      args: {
        searchContextSize: "medium",
      },
    })
  })
})

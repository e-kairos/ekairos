/* @vitest-environment node */

import { describe, expect, it } from "vitest"

import { createContext } from "../context.ts"
import type { StoredContext } from "@ekairos/events"
import type { ContextRuntimeHandleForDomain } from "../context.runtime.ts"

type ContractEnv = {
  orgId: string
}

function createStoredContext<Context>(
  content: Context | null,
): StoredContext<Context> {
  return {
    id: "ctx_contract_builder",
    key: "context.tests.builder-contract",
    status: "open_idle",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    content,
  }
}

describe("createContext content/resources/description/goal contract", () => {
  it("builds content first, then resources, then derives description and goal", async () => {
    const order: string[] = []
    const builder = createContext<ContractEnv>("context.tests.builder-contract")
      .content((stored, env) => {
        order.push("content")
        return {
          ...(stored.content ?? {}),
          orgId: env.orgId,
          tenderId: "tender_contract",
        }
      })
      .resources(({ content, env, runtime }) => {
        order.push("resources")
        expect(content.tenderId).toBe("tender_contract")
        expect(env.orgId).toBe("org_contract")
        expect(runtime).toBeTruthy()
        return [
          {
            type: "file",
            key: `tender:${content.tenderId}:file:technical-spec`,
            name: "Technical spec",
            description: "Tender technical specification.",
            fileId: "file_contract",
            mediaType: "application/pdf",
          },
        ]
      })
      .resource(({ content }) => ({
        type: "link",
        key: `tender:${content.tenderId}:link:reference`,
        name: "Reference link",
        description: "External reference for the tender.",
        url: "https://example.com/reference",
      }))
      .description((content) => {
        order.push("description")
        return `Technical evaluation context for ${content.tenderId}.`
      })
      .goal((content) => {
        order.push("goal")
        return `Evaluate evidence for org ${content.orgId}.`
      })
      .actions(() => ({}))

    const config = builder.config()
    const env = { orgId: "org_contract" }
    const runtime = {} as ContextRuntimeHandleForDomain<ContractEnv, any>
    const stored = createStoredContext<Record<string, unknown>>(null)

    const content = await config.context(stored, env, runtime)
    const contextWithContent = createStoredContext(content)
    const resources = await config.resources?.({
      content,
      context: contextWithContent,
      env,
      runtime,
    })
    const description = await config.description?.(content, contextWithContent, env, runtime)
    const goal = await config.goal?.(content, contextWithContent, env, runtime)

    expect(order).toEqual(["content", "resources", "description", "goal"])
    expect(content).toEqual({
      orgId: "org_contract",
      tenderId: "tender_contract",
    })
    expect(resources).toEqual([
      {
        type: "file",
        key: "tender:tender_contract:file:technical-spec",
        name: "Technical spec",
        description: "Tender technical specification.",
        fileId: "file_contract",
        mediaType: "application/pdf",
      },
      {
        type: "link",
        key: "tender:tender_contract:link:reference",
        name: "Reference link",
        description: "External reference for the tender.",
        url: "https://example.com/reference",
      },
    ])
    expect(description).toBe("Technical evaluation context for tender_contract.")
    expect(goal).toBe("Evaluate evidence for org org_contract.")
  })

  it("keeps context() as a legacy alias for content()", async () => {
    const config = createContext<ContractEnv>("context.tests.builder-legacy-context")
      .context((stored, env) => ({
        ...(stored.content ?? {}),
        orgId: env.orgId,
      }))
      .description((content) => `Context for ${content.orgId}.`)
      .goal(() => "Keep legacy context() callers working while new code uses content().")
      .actions(() => ({}))
      .config()

    const content = await config.context(
      createStoredContext(null),
      { orgId: "org_legacy" },
      {} as ContextRuntimeHandleForDomain<ContractEnv, any>,
    )

    expect(content).toEqual({ orgId: "org_legacy" })
  })

  it("lets resources() calls chain without replacing earlier resources", async () => {
    const builder = createContext<ContractEnv>("context.tests.builder-resources-chain")
      .content((stored, env) => ({
        ...(stored.content ?? {}),
        orgId: env.orgId,
        awardId: "award_contract",
      }))
      .resources(({ content }) => [
        {
          type: "file",
          key: `award:${content.awardId}:file:evidence`,
          name: "Evidence file",
          description: "File evidence for the award.",
          fileId: "file_award",
        },
      ])
      .resources(({ content }) => [
          {
            type: "repository",
            key: `award:${content.awardId}:repo:integration`,
            name: "Integration repository",
            description: "Repository with integration artifacts.",
            repository: "ekairos/integration",
          },
      ])
      .description((content) => `Resource-aware context for ${content.awardId}.`)
      .goal(() => "Use context resources as available materials.")
      .actions(() => ({}))

    const config = builder.config()
    const env = { orgId: "org_resources" }
    const runtime = {} as ContextRuntimeHandleForDomain<ContractEnv, any>
    const stored = createStoredContext<Record<string, unknown>>(null)
    const content = await config.context(stored, env, runtime)
    const resources = await config.resources?.({
      content,
      context: createStoredContext(content),
      env,
      runtime,
    })

    expect(resources).toEqual([
      {
        type: "file",
        key: "award:award_contract:file:evidence",
        name: "Evidence file",
        description: "File evidence for the award.",
        fileId: "file_award",
      },
      {
        type: "repository",
        key: "award:award_contract:repo:integration",
        name: "Integration repository",
        description: "Repository with integration artifacts.",
        repository: "ekairos/integration",
      },
    ])
  })

  it("renders default prompt as content, resources, description, then goal", async () => {
    const contract = createContext<ContractEnv>("context.tests.builder-prompt")
      .content((stored, env) => ({
        ...(stored.content ?? {}),
        orgId: env.orgId,
        tenderId: "tender_prompt",
      }))
      .resource({
        type: "file",
        key: "tender:tender_prompt:file:pricing",
        name: "Pricing sheet",
        description: "Commercial spreadsheet attached to the context.",
        fileId: "file_pricing",
      })
      .description((content) => `Context for ${content.tenderId}.`)
      .goal(() => "Evaluate with the attached resources.")
      .actions(() => ({}))
      .build()

    const prompt = await (contract as any).buildSystemPrompt(
      {
        ...createStoredContext({
          orgId: "org_prompt",
          tenderId: "tender_prompt",
        }),
        resources: [
          {
            type: "file",
            key: "tender:tender_prompt:file:pricing",
            name: "Pricing sheet",
            description: "Commercial spreadsheet attached to the context.",
            fileId: "file_pricing",
          },
        ],
        description: "Context for tender_prompt.",
        goal: "Evaluate with the attached resources.",
      },
      { orgId: "org_prompt" },
      {} as ContextRuntimeHandleForDomain<ContractEnv, any>,
    )

    expect(prompt).toContain("Content:")
    expect(prompt).toContain("Resources:")
    expect(prompt).toContain("Description:")
    expect(prompt).toContain("Goal:")
    expect(prompt.indexOf("Content:")).toBeLessThan(prompt.indexOf("Resources:"))
    expect(prompt.indexOf("Resources:")).toBeLessThan(prompt.indexOf("Description:"))
    expect(prompt.indexOf("Description:")).toBeLessThan(prompt.indexOf("Goal:"))
    expect(prompt).toContain("Pricing sheet")
  })
})

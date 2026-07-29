/* @vitest-environment node */

import { describe, expect, it } from "vitest"

import {
  agentDatasetInputSchema,
  resolveAgentDatasetSource,
  validateAgentDatasetQuery,
  type AgentDatasetDomainDescriptor,
} from "../agent-dataset.js"

const scopedDomain: AgentDatasetDomainDescriptor = {
  name: "clinical",
  entities: {
    subjects: {
      attributes: {
        subjectKey: { type: "string", required: true, indexed: true },
      },
      links: {
        forms: { entity: "forms", cardinality: "many" },
      },
    },
    forms: {
      attributes: {
        formOID: { type: "string", required: true, indexed: true },
      },
      links: {},
    },
  },
}

describe("agent Dataset query scope", () => {
  it("keeps Dataset purpose beside its title instead of nesting it in the source", () => {
    const input = agentDatasetInputSchema.parse({
      title: "Clinical cohort",
      explanation: "Snapshot every subject before grouping diagnoses.",
      source: {
        kind: "query",
        query: { subjects: { $: { fields: ["subjectKey"] } } },
      },
    })

    expect(resolveAgentDatasetSource(input, {
      domain: scopedDomain,
      given: { rows: [] },
    })).toMatchObject({
      title: "Clinical cohort",
      explanation: "Snapshot every subject before grouping diagnoses.",
      query: { subjects: { $: { fields: ["subjectKey"] } } },
    })
  })

  it("rejects the former nested explanation shape", () => {
    expect(() => agentDatasetInputSchema.parse({
      title: "Clinical cohort",
      source: {
        kind: "query",
        explanation: "Hidden inside the source.",
        query: { subjects: {} },
      },
    })).toThrow()
  })

  it("accepts a nested InstaQL query within the Reaction domain", () => {
    expect(() => validateAgentDatasetQuery({
      subjects: {
        $: { fields: ["subjectKey"], limit: 100 },
        forms: { $: { fields: ["formOID"] } },
      },
    }, scopedDomain)).not.toThrow()
  })

  it.each([
    [
      "entity",
      { users: {} },
      "reaction_dataset_query_entity_outside_scope:users",
    ],
    [
      "field",
      { subjects: { $: { fields: ["secret"] } } },
      "reaction_dataset_query_field_outside_scope:subjects.secret",
    ],
    [
      "link",
      { subjects: { accounts: {} } },
      "reaction_dataset_query_link_outside_scope:subjects.accounts",
    ],
    [
      "selection",
      { subjects: true },
      "reaction_dataset_query_selection_invalid:subjects",
    ],
    [
      "fields option",
      { subjects: { $: { fields: "subjectKey" } } },
      "reaction_dataset_query_fields_invalid:subjects",
    ],
  ])("rejects an invalid %s", (_label, query, error) => {
    expect(() => validateAgentDatasetQuery(query, scopedDomain)).toThrow(error)
  })
})

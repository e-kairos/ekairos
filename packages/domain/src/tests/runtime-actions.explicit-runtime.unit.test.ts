/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineDomainAction, domain } from "../index.ts";
import { DomainRuntime } from "./runtime-actions.test-fixtures.ts";

describe("runtime action explicit runtime instance", () => {
  it("lets internal clients use an explicit runtime instance directly", async () => {
    // given: a concrete Runtime subclass whose db payload contains a known
    // runtimeCall marker.
    const baseExplicitDomain = domain("explicit").schema({
      entities: {},
      links: {},
      rooms: {},
    });

    let explicitDomain: any;
    explicitDomain = baseExplicitDomain.withActions({
      normalizeTitle: defineDomainAction({
        input: z.object({ title: z.string() }),
        output: z.object({ title: z.string(), runtimeCall: z.number() }),
        async execute({ input, domain }) {
            return {
            title: String(input.title).trim(),
            runtimeCall: domain.db.runtimeCall,
          };
        },
      }),
      createTask: defineDomainAction({
        input: z.object({ title: z.string() }),
        output: z.object({
          title: z.string(),
          orgId: z.string(),
          parentRuntimeCall: z.number(),
          nestedRuntimeCall: z.number(),
        }),
        async execute({ runtime, domain, input }) {
            const normalized = await domain.actions.normalizeTitle({ title: input.title });
          return {
            title: normalized.title,
            orgId: runtime.env.orgId,
            parentRuntimeCall: domain.db.runtimeCall,
            nestedRuntimeCall: normalized.runtimeCall,
          };
        },
      }),
    });

    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      explicitDomain,
      7,
    );
    const explicit = await runtime.use(explicitDomain);

    // when: an internal caller invokes the scoped action directly without the
    // global runtime action registry.
    const result = await explicit.actions.createTask({ title: "  Runtime first  " });

    // then: parent and nested actions share the same explicit runtime instance.
    expect(result).toEqual({
      title: "Runtime first",
      orgId: "org_123",
      parentRuntimeCall: 7,
      nestedRuntimeCall: 7,
    });
  });
});

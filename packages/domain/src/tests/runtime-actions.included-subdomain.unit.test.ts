/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";
import { z } from "zod";

import { defineDomainAction, domain } from "../index.ts";
import { DomainRuntime } from "./runtime-actions.test-fixtures.ts";

describe("runtime action included subdomain scoping", () => {
  it("materializes an included subdomain with domain.db and domain.actions", async () => {
    // given: an app domain that includes a tasks subdomain with its own actions.
    const baseTasksDomain = domain("tasks").schema({
      entities: {
        tasks: i.entity({
          title: i.string(),
          status: i.string(),
        }),
      },
      links: {},
      rooms: {},
    });

    let tasksDomain: any;
    tasksDomain = baseTasksDomain.withActions({
      normalizeTitle: defineDomainAction({
        description: "Normalize title",
        input: z.object({ title: z.string() }),
        output: z.object({ title: z.string(), runtimeCall: z.number() }),
        execute: async ({ input, runtime }) => {
          "use step";
          const scoped = await runtime.use(tasksDomain);
          return {
            title: String(input.title).trim(),
            runtimeCall: scoped.db.runtimeCall,
          };
        },
      }),
      createTask: defineDomainAction({
        description: "Create task",
        input: z.object({ title: z.string() }),
        output: z.object({
          title: z.string(),
          orgId: z.string(),
          runtimeCall: z.number(),
        }),
        execute: async ({ input, runtime }) => {
          "use step";
          const scoped = await runtime.use(tasksDomain);
          const normalized = await scoped.actions.normalizeTitle({ title: input.title });
          return {
            title: normalized.title,
            orgId: runtime.env.orgId,
            runtimeCall: normalized.runtimeCall,
          };
        },
      }),
    });

    const appDomain = domain("app")
      .includes(tasksDomain)
      .schema({ entities: {}, links: {}, rooms: {} });

    const runtime = new DomainRuntime(
      { orgId: "org_123", actorId: "user_1" },
      appDomain,
      9,
    );

    // when: the root runtime is scoped to the included tasks domain and the
    // tasks action is executed through that scoped handle.
    const tasks = await runtime.use(tasksDomain);
    const result = await tasks.actions.createTask({ title: "  Ship it  " });

    // then: the scoped subdomain exposes the root runtime db/env and keeps its
    // local action surface.
    expect(tasks.db.runtimeCall).toBe(9);
    expect(tasks.env.orgId).toBe("org_123");
    expect(result).toEqual({
      title: "Ship it",
      orgId: "org_123",
      runtimeCall: 9,
    });
  });
});

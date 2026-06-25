/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";
import { z } from "zod";

import { defineDomainAction, domain, getDomainActionBinding } from "../index.ts";

describe("domain action reflection", () => {
  it("exposes declared actions as a typed raw definition object", () => {
    // given: a domain definition with a single named action registered through
    // withActions(), using the public action key as the reflection key.
    const managementDomain = domain("management")
      .withSchema({
        entities: {
          management_tasks: i.entity({
            title: i.string(),
          }),
        },
        links: {},
        rooms: {},
      })
      .withActions({
        getTask: defineDomainAction({
          name: "management.task.get",
          input: z.object({ taskId: z.string() }),
          output: z.object({ title: z.string() }),
          execute: async ({ input }) => ({ title: input.taskId }),
        }),
      });

    // when: callers inspect the domain definition instead of binding a runtime.
    const reflectedActions = managementDomain.actions;

    // then: the raw action definitions are available by their literal keys and
    // the reflected object is immutable.
    expect(Object.keys(reflectedActions)).toEqual(["getTask"]);
    expect(reflectedActions.getTask.name).toBe("management.task.get");
    expect(Object.isFrozen(reflectedActions)).toBe(true);

    const binding = getDomainActionBinding(reflectedActions.getTask);
    expect(binding?.name).toBe("management.task.get");
    expect(binding?.key).toBe("getTask");
    expect(binding?.domain).toBe(managementDomain);
  });
});

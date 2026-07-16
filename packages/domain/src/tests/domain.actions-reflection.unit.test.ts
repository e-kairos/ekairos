/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";
import { z } from "zod";

import { defineDomainAction, domain } from "../index.ts";
import * as domainRoot from "../index.ts";
import { getDomainActionBinding } from "../internal.ts";

describe("domain action reflection", () => {
  it("keeps action execution off the root entrypoint", () => {
    expect(domainRoot).not.toHaveProperty("getDomainActionBinding");
    expect(domainRoot).not.toHaveProperty("prepareDomainActionExecution");
    expect(domainRoot).not.toHaveProperty("executeDomainAction");
  });

  it("exposes immutable opaque registrations with canonical identity", () => {
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
    expect(reflectedActions.getTask).toMatchObject({
      id: "management.getTask",
      ownerDomain: "management",
      key: "getTask",
    });
    expect(reflectedActions.getTask).not.toHaveProperty("name");
    expect(reflectedActions.getTask).not.toHaveProperty("execute");
    expect(reflectedActions.getTask).not.toHaveProperty("ownerDomainObject");
    expect(Object.isFrozen(reflectedActions.getTask)).toBe(true);
    expect(Object.isFrozen(reflectedActions)).toBe(true);

    const binding = getDomainActionBinding(reflectedActions.getTask);
    expect(binding?.id).toBe("management.getTask");
    expect(binding?.ownerDomain).toBe("management");
    expect(binding?.key).toBe("getTask");
    expect(binding?.ownerDomainObject).toBe(managementDomain);
    expect(binding?.boundInput).toEqual({});
    expect(Object.isFrozen(binding)).toBe(true);
  });
});

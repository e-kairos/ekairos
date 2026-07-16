/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";
import { z } from "zod";

import { defineDomainAction, domain } from "../index.ts";

describe("domain action registration immutability", () => {
  it("rejects array-shaped action collections", () => {
    const baseDomain = domain("management-list").schema({
      entities: {},
      links: {},
      rooms: {},
    });
    const action = defineDomainAction({
      input: z.object({}),
      output: z.object({ ok: z.literal(true) }),
      execute: async () => ({ ok: true }),
    });

    expect(() => baseDomain.withActions([action] as any)).toThrow(
      "Invalid domain action collection",
    );
  });

  it("returns a new immutable domain result when registering actions", () => {
    // given: a materialized domain with no actions and two independently
    // defined action descriptors.
    const baseDomain = domain("management").schema({
      entities: {
        management_tasks: i.entity({
          title: i.string(),
        }),
      },
      links: {},
      rooms: {},
    });

    const createTask = defineDomainAction({
      input: z.object({}),
      output: z.object({ ok: z.literal(true) }),
      execute: async () => ({ ok: true }),
    });
    const updateTask = defineDomainAction({
      input: z.object({}),
      output: z.object({ ok: z.literal(true) }),
      execute: async () => ({ ok: true }),
    });

    // when: actions are registered in two steps.
    const withCreate = baseDomain.withActions({ createTask });
    const withCreateAndUpdate = withCreate.withActions({ updateTask });

    // then: each registration returns a new domain value and preserves the
    // action list that existed at that point in the chain.
    expect(baseDomain).not.toBe(withCreate);
    expect(withCreate).not.toBe(withCreateAndUpdate);
    expect(withCreate.getActions().map((entry) => entry.id)).toEqual([
      "management.createTask",
    ]);
    expect(withCreateAndUpdate.getActions().map((entry) => entry.id)).toEqual([
      "management.createTask",
      "management.updateTask",
    ]);
    expect(Object.values(withCreateAndUpdate.actions).map((entry) => entry.id)).toEqual([
      "management.createTask",
      "management.updateTask",
    ]);
    expect(Object.isFrozen(withCreateAndUpdate.actions.createTask)).toBe(true);
  });
});

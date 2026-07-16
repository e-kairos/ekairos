/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineDomainAction, domain } from "../index.ts";
import {
  executeDomainAction,
  getDomainActionBinding,
} from "../internal.ts";
import { DomainRuntime } from "./runtime-actions.test-fixtures.ts";

function createOwnerDomain(onRuntime: (runtime: unknown) => void = () => {}) {
  return domain("owner")
    .withSchema({ entities: {}, links: {}, rooms: {} })
    .withActions({
      save: defineDomainAction({
        description: "Save an owner value.",
        input: z.object({ value: z.number().min(1) }),
        output: z.object({ value: z.number(), runtimeCall: z.number() }),
        execute: async ({ input, runtime, domain: activeDomain }) => {
          onRuntime(runtime);
          return {
            value: input.value,
            runtimeCall: activeDomain.db.runtimeCall,
          };
        },
      }),
    });
}

describe("domain action runtime contract", () => {
  it("preserves canonical ownership when a root re-exposes an action", async () => {
    let receivedRuntime: unknown;
    const ownerDomain = createOwnerDomain((runtime) => {
      receivedRuntime = runtime;
    });
    const rootDomain = domain("root")
      .includes(ownerDomain)
      .withSchema({ entities: {}, links: {}, rooms: {} })
      .withActions({ saveOwner: ownerDomain.actions.save });

    const registration = rootDomain.actions.saveOwner;
    expect(registration).toBe(ownerDomain.actions.save);
    expect(registration).toMatchObject({
      id: "owner.save",
      ownerDomain: "owner",
      key: "save",
    });
    const binding = getDomainActionBinding(registration);
    expect(binding?.ownerDomainObject).toBe(ownerDomain);

    const runtime = new DomainRuntime(
      { orgId: "org_1", actorId: "user_1" },
      rootDomain,
      17,
    );
    const root = await runtime.use(rootDomain);
    const output = await root.actions.saveOwner({ value: 2 });

    expect(receivedRuntime).toBe(runtime);
    expect(output).toEqual({ value: 2, runtimeCall: 17 });
  });

  it("rejects a foreign action with the same local key", async () => {
    const ownerDomain = createOwnerDomain();
    const foreignDomain = domain("foreign")
      .withSchema({ entities: {}, links: {}, rooms: {} })
      .withActions({
        save: defineDomainAction({
          input: z.object({ value: z.number() }),
          output: z.object({ value: z.number() }),
          execute: ({ input }) => input,
        }),
      });
    const rootDomain = domain("root-membership")
      .includes(ownerDomain)
      .withSchema({ entities: {}, links: {}, rooms: {} })
      .withActions({ save: ownerDomain.actions.save });
    const runtime = new DomainRuntime(
      { orgId: "org_1", actorId: "user_1" },
      rootDomain,
      1,
    );

    await expect(
      executeDomainAction(runtime, foreignDomain.actions.save, { value: 1 }),
    ).rejects.toThrow("domain_action_outside_runtime:foreign.save");
  });

  it("validates input before implementation and validates output afterward", async () => {
    let calls = 0;
    const validationDomain = domain("validation")
      .withSchema({ entities: {}, links: {}, rooms: {} })
      .withActions({
        validate: defineDomainAction({
          input: z.object({ value: z.number().positive() }),
          output: z.object({ result: z.number() }),
          execute: ({ input }) => {
            calls += 1;
            return input.value === 13
              ? ({ result: "invalid" } as any)
              : { result: input.value };
          },
        }),
      });
    const runtime = new DomainRuntime(
      { orgId: "org_1", actorId: "user_1" },
      validationDomain,
      1,
    );

    await expect(
      executeDomainAction(runtime, validationDomain.actions.validate, {
        value: 0,
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(calls).toBe(0);

    const active = await runtime.use(validationDomain);
    await expect(active.actions.validate({ value: 13 })).rejects.toBeInstanceOf(
      z.ZodError,
    );
    expect(calls).toBe(1);
  });
});

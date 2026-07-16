/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";
import { z } from "zod";

import {
  defineDomainAction,
  domain,
  scopeAction,
} from "../index.ts";
import {
  executeDomainAction,
  getDomainActionBinding,
  prepareDomainActionExecution,
} from "../internal.ts";
import { DomainRuntime } from "./runtime-actions.test-fixtures.ts";

function createScopedActionDomain(onExecute: () => void = () => {}) {
  return domain("scoped-action")
    .schema({
      entities: {
        scoped_action_bids: i.entity({
          title: i.string(),
        }),
      },
      links: {},
      rooms: {},
    })
    .withActions({
      updateBid: defineDomainAction({
        input: z.object({
          bidId: z.string().transform((value) => value.trim()),
          instructions: z.string(),
          fileIds: z.array(z.string()).optional(),
        }),
        output: z.object({
          bidId: z.string(),
          instructions: z.string(),
          fileIds: z.array(z.string()).optional(),
          orgId: z.string(),
          runtimeCall: z.number(),
        }),
        execute: async ({ input, runtime, domain }) => {
          onExecute();
          return {
            bidId: input.bidId,
            instructions: input.instructions,
            fileIds: input.fileIds,
            orgId: runtime.env.orgId,
            runtimeCall: domain.db.runtimeCall,
          };
        },
      }),
    });
}

describe("scoped domain actions", () => {
  it("creates a pure scoped action that binds part of an object input", async () => {
    let implementationCalls = 0;
    const bidsDomain = createScopedActionDomain(() => {
      implementationCalls += 1;
    });

    const scopedUpdate = scopeAction(bidsDomain.actions.updateBid, {
      bidId: "  bid_1  ",
    });

    expect(scopedUpdate.input.parse({ instructions: "review totals" })).toEqual({
      instructions: "review totals",
    });
    expect(() => scopedUpdate.input.parse({})).toThrow();
    expect(Object.keys((scopedUpdate.inputSchema as any).properties)).toEqual([
      "instructions",
      "fileIds",
    ]);

    const binding = getDomainActionBinding(scopedUpdate);
    expect(binding?.id).toBe("scoped-action.updateBid");
    expect(binding?.ownerDomain).toBe("scoped-action");
    expect(binding?.key).toBe("updateBid");
    expect(binding?.ownerDomainObject).toBe(bidsDomain);
    expect(binding?.boundInput).toEqual({ bidId: "bid_1" });

    const runtime = new DomainRuntime(
      { orgId: "org_1", actorId: "user_1" },
      bidsDomain,
      3,
    );
    const preparation = await prepareDomainActionExecution(
      runtime,
      scopedUpdate,
      {
        instructions: "review totals",
        fileIds: ["file_1"],
      },
    );

    expect(implementationCalls).toBe(0);
    expect(Object.isFrozen(preparation)).toBe(true);
    expect(Object.isFrozen(preparation.effectiveInput)).toBe(true);
    expect(preparation.effectiveInput).toEqual({
      bidId: "bid_1",
      instructions: "review totals",
      fileIds: ["file_1"],
    });
    const execution = await executeDomainAction(
      runtime,
      scopedUpdate,
      preparation,
    );

    expect(implementationCalls).toBe(1);
    expect(execution.effectiveInput).toBe(preparation.effectiveInput);
    expect(execution.output).toEqual({
      bidId: "bid_1",
      instructions: "review totals",
      fileIds: ["file_1"],
      orgId: "org_1",
      runtimeCall: 3,
    });
  });

  it("rejects unknown scoped inputs and non-object action inputs", () => {
    const bidsDomain = createScopedActionDomain();

    expect(() =>
      scopeAction(bidsDomain.actions.updateBid, { missingId: "x" } as any),
    ).toThrow("domain_action_scope_unknown_input:scoped-action.updateBid.missingId");

    const textDomain = domain("text-action")
      .schema({ entities: {}, links: {}, rooms: {} })
      .withActions({
        echo: defineDomainAction({
          input: z.string(),
          output: z.string(),
          execute: ({ input }) => input,
        }),
      });

    expect(() => scopeAction(textDomain.actions.echo, {} as any)).toThrow(
      "domain_action_scope_requires_object_input:text-action.echo",
    );
  });

  it("exposes .scope() on runtime-bound action methods", async () => {
    const bidsDomain = createScopedActionDomain();
    const runtime = new DomainRuntime(
      { orgId: "org_runtime", actorId: "user_1" },
      bidsDomain,
      9,
    );
    const scoped = await runtime.use(bidsDomain);

    const updateConcreteBid = scoped.actions.updateBid.scope({ bidId: "bid_2" });
    expect(updateConcreteBid).not.toHaveProperty("execute");
    const runtimeResult = await updateConcreteBid({
      instructions: "approve supplier",
    });
    const registration = bidsDomain.actions.updateBid.scope({ bidId: "bid_2" });
    const internalResult = await executeDomainAction(runtime, registration, {
      instructions: "approve supplier",
    });

    expect(runtimeResult).toEqual({
      bidId: "bid_2",
      instructions: "approve supplier",
      fileIds: undefined,
      orgId: "org_runtime",
      runtimeCall: 9,
    });
    expect(internalResult.output).toEqual(runtimeResult);
    expect(internalResult.effectiveInput).toMatchObject({ bidId: "bid_2" });
  });
});

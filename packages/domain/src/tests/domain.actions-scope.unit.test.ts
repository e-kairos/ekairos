/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";
import { z } from "zod";

import {
  defineDomainAction,
  domain,
  getDomainActionBinding,
  scopeAction,
} from "../index.ts";
import { DomainRuntime } from "./runtime-actions.test-fixtures.ts";

function createScopedActionDomain() {
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
        name: "scopedAction.updateBid",
        input: z.object({
          bidId: z.string(),
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
        execute: async ({ input, runtime }) => ({
          bidId: input.bidId,
          instructions: input.instructions,
          fileIds: input.fileIds,
          orgId: runtime.env.orgId,
          runtimeCall: runtime.db.runtimeCall,
        }),
      }),
    });
}

describe("scoped domain actions", () => {
  it("creates a pure scoped action that binds part of an object input", async () => {
    const bidsDomain = createScopedActionDomain();

    const scopedUpdate = scopeAction(bidsDomain.actions.updateBid, {
      bidId: "bid_1",
    });

    expect(scopedUpdate.input.parse({ instructions: "review totals" })).toEqual({
      instructions: "review totals",
    });
    expect(() => scopedUpdate.input.parse({})).toThrow();

    const binding = getDomainActionBinding(scopedUpdate);
    expect(binding?.name).toBe("scopedAction.updateBid");
    expect(binding?.key).toBe("updateBid");
    expect(binding?.domain).toBe(bidsDomain);

    const result = await scopedUpdate.execute({
      input: {
        instructions: "review totals",
        fileIds: ["file_1"],
      },
      runtime: {
        env: { orgId: "org_1" },
        db: { runtimeCall: 3 },
      } as any,
    });

    expect(result).toEqual({
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
    ).toThrow("domain_action_scope_unknown_input:scopedAction.updateBid.missingId");

    const textDomain = domain("text-action")
      .schema({ entities: {}, links: {}, rooms: {} })
      .withActions({
        echo: defineDomainAction({
          name: "text.echo",
          input: z.string(),
          output: z.string(),
          execute: ({ input }) => input,
        }),
      });

    expect(() => scopeAction(textDomain.actions.echo, {} as any)).toThrow(
      "domain_action_scope_requires_object_input:text.echo",
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
    const result = await updateConcreteBid({
      instructions: "approve supplier",
    });

    expect(result).toEqual({
      bidId: "bid_2",
      instructions: "approve supplier",
      fileIds: undefined,
      orgId: "org_runtime",
      runtimeCall: 9,
    });
  });
});

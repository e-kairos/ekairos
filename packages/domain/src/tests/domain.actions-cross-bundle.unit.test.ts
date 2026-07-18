import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

describe("domain action registration across bundles", () => {
  it("recognizes actions created by another module instance in the same realm", async () => {
    const first = await import("../index.ts");
    const echo = first.defineDomainAction({
      input: z.object({ value: z.string() }),
      output: z.object({ value: z.string() }),
      execute: async ({ input }) => input,
    });
    const root = first.domain("crossBundle")
      .withSchema({ entities: {}, links: {}, rooms: {} })
      .withActions({ echo });

    expect(first.getDomainActions(root).map(action => action.id)).toEqual([
      "crossBundle.echo",
    ]);

    vi.resetModules();
    const second = await import("../index.ts");
    const secondInternal = await import("../internal.ts");
    const actions = second.getDomainActions(root);

    expect(actions.map(action => action.id)).toEqual(["crossBundle.echo"]);
    expect(secondInternal.getDomainActionBinding(actions[0]!)?.id).toBe(
      "crossBundle.echo",
    );
  });
});

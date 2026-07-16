import { i } from "@instantdb/core";
import { z } from "zod";

import { EkairosRuntime } from "../runtime.ts";
import { defineDomainAction, domain } from "../index.ts";

export type RuntimeActionEnv = {
  orgId: string;
  actorId: string;
};

export type RuntimeActionShape = {
  db: {
    runtimeCall: number;
    query: (input: unknown) => Promise<{ input: unknown; runtimeCall: number }>;
  };
};

export class DomainRuntime<RootDomain> extends EkairosRuntime<
  RuntimeActionEnv,
  RootDomain,
  RuntimeActionShape["db"]
> {
  private readonly runtimeCall: number;
  private readonly rootDomain: RootDomain;

  constructor(env: RuntimeActionEnv, rootDomain: RootDomain, runtimeCall = 1) {
    super(env);
    this.rootDomain = rootDomain;
    this.runtimeCall = runtimeCall;
  }

  protected getDomain() {
    return this.rootDomain;
  }

  protected async resolveDb() {
    return {
      runtimeCall: this.runtimeCall,
      query: async (input: unknown) => ({ input, runtimeCall: this.runtimeCall }),
    };
  }
}

export function createManagementDomain() {
  const baseDomain = domain("management").schema({
    entities: {
      management_tasks: i.entity({
        title: i.string(),
        status: i.string().indexed(),
      }),
    },
    links: {},
    rooms: {},
  });

  let appDomain: any;
  appDomain = baseDomain.withActions({
    normalizeTitle: defineDomainAction({
      description: "Normalize task titles.",
      input: z.object({ title: z.string() }),
      output: z.object({
        title: z.string(),
        status: z.literal("draft"),
        runtimeCall: z.number(),
      }),
      execute: async ({ input, domain }) => {
        return {
          title: String(input.title).trim(),
          status: "draft" as const,
          runtimeCall: domain.db.runtimeCall,
        };
      },
    }),
    createTask: defineDomainAction({
      description: "Create a draft task.",
      input: z.object({ title: z.string() }),
      output: z.object({
        title: z.string(),
        status: z.literal("draft"),
        orgId: z.string(),
        parentRuntimeCall: z.number(),
        nestedRuntimeCall: z.number(),
      }),
      execute: async ({ input, runtime, domain }) => {
        const normalized = await domain.actions.normalizeTitle({ title: input.title });
        return {
          title: normalized.title,
          status: normalized.status,
          orgId: runtime.env.orgId,
          parentRuntimeCall: domain.db.runtimeCall,
          nestedRuntimeCall: normalized.runtimeCall,
        };
      },
    }),
  });

  return { appDomain };
}

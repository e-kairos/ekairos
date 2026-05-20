import { i } from "@instantdb/core";
import { z } from "zod";

import { defineDomainAction, domain, EkairosRuntime } from "../index";

type Env = {
  orgId: string;
};

const taskDomain = domain("callable-runtime-tasks")
  .schema({
    entities: {
      tasks: i.entity({
        title: i.string(),
        status: i.string(),
      }),
    },
    links: {},
    rooms: {},
  })
  .withActions({
    createTask: defineDomainAction({
      input: z.object({ title: z.string() }),
      output: z.object({ title: z.string(), status: z.literal("draft") }),
      execute: async ({ input }) => ({
        title: input.title,
        status: "draft" as const,
      }),
    }),
  });

const billingDomain = domain("callable-runtime-billing").schema({
  entities: {
    invoices: i.entity({
      status: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const appDomain = domain("callable-runtime-app")
  .includes(taskDomain)
  .schema({ entities: {}, links: {}, rooms: {} });

class AppRuntime extends EkairosRuntime<Env, typeof appDomain, any> {
  protected getDomain() {
    return appDomain;
  }

  protected async resolveDb() {
    return {};
  }
}

class BillingRuntime extends EkairosRuntime<Env, typeof billingDomain, any> {
  protected getDomain() {
    return billingDomain;
  }

  protected async resolveDb() {
    return {};
  }
}

async function checkCallableDomainRuntime() {
  const appRuntime = new AppRuntime({ orgId: "org_1" });
  const tasks = await taskDomain(appRuntime);

  await tasks.createTask({ title: "Ship it" });
  await tasks.actions.createTask({ title: "Ship it" });
  await tasks.query({ tasks: {} });
  await tasks.db.query({ tasks: {} });

  // @ts-expect-error promoted action input keeps the declared shape.
  await tasks.createTask({ wrong: "Ship it" });

  // @ts-expect-error explicit action input keeps the declared shape.
  await tasks.actions.createTask({ wrong: "Ship it" });

  // @ts-expect-error query remains scoped to the callable domain schema.
  await tasks.query({ invoices: {} });

  // @ts-expect-error db query remains scoped to the callable domain schema.
  await tasks.db.query({ invoices: {} });

  // @ts-expect-error writes stay behind domain actions.
  await tasks.transact([]);

  const billingRuntime = new BillingRuntime({ orgId: "org_1" });

  // @ts-expect-error billing runtime does not include taskDomain.
  await taskDomain(billingRuntime);
}

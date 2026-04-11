import { i } from "@instantdb/core";

import {
  type CompatibleRuntimeForDomain,
  EkairosRuntime,
  domain,
} from "../index";

type Env = {
  orgId: string;
  actorId: string;
};

const taskDomain = domain("tasks").schema({
  entities: {
    tasks: i.entity({
      title: i.string(),
      status: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const billingDomain = domain("billing").schema({
  entities: {
    invoices: i.entity({
      total: i.number(),
      status: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const appDomain = domain("app")
  .includes(taskDomain)
  .schema({ entities: {}, links: {}, rooms: {} });

class AppRuntime extends EkairosRuntime<Env, typeof appDomain, { runtimeCall: number }> {
  protected getDomain() {
    return appDomain;
  }

  protected async resolveDb() {
    return { runtimeCall: 1 };
  }
}

class BillingRuntime extends EkairosRuntime<Env, typeof billingDomain, { runtimeCall: number }> {
  protected getDomain() {
    return billingDomain;
  }

  protected async resolveDb() {
    return { runtimeCall: 2 };
  }
}

function taskMethod<Runtime extends EkairosRuntime<any, any, any>>(
  runtime: CompatibleRuntimeForDomain<Runtime, typeof taskDomain>,
) {
  return runtime;
}

const appRuntime = new AppRuntime({ orgId: "org_1", actorId: "user_1" });
taskMethod(appRuntime);
appRuntime.use(taskDomain);

const billingRuntime = new BillingRuntime({ orgId: "org_1", actorId: "user_1" });
// @ts-expect-error billing runtime does not include taskDomain
taskMethod(billingRuntime);
// @ts-expect-error billing runtime does not include taskDomain
billingRuntime.use(taskDomain);

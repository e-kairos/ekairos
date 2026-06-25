/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { init } from "@instantdb/admin";
import { i } from "@instantdb/core";

import { EkairosRuntime, domain } from "../index.ts";

type Env = {
  orgId: string;
};

const taskDomain = domain("scoped-instant-tasks").schema({
  entities: {
    scoped_tasks: i.entity({
      title: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

const billingDomain = domain("scoped-instant-billing").schema({
  entities: {
    scoped_invoices: i.entity({
      total: i.number(),
    }),
  },
  links: {},
  rooms: {},
});

const appDomain = domain("scoped-instant-app")
  .includes(taskDomain)
  .includes(billingDomain)
  .schema({
    entities: {},
    links: {},
    rooms: {},
  });

class AppRuntime extends EkairosRuntime<Env, typeof appDomain, any> {
  private readonly rootDb = init({
    appId: "00000000-0000-4000-8000-000000000001",
    adminToken: "test-admin-token",
    schema: appDomain.instantSchema(),
  });

  protected getDomain() {
    return appDomain;
  }

  protected resolveDb() {
    return this.rootDb;
  }
}

describe("runtime action scoped InstantDB", () => {
  it("recreates Instant Admin DB with the scoped subdomain schema", async () => {
    // given: a root runtime whose physical Instant app schema contains tasks
    // and billing entities.
    const runtime = new AppRuntime({ orgId: "org_123" });

    // when: callers materialize only the tasks subdomain.
    const tasks = (await runtime.use(taskDomain)) as any;

    // then: the materialized DB validates locally against the tasks subdomain,
    // not the broader root schema. These calls throw before any network fetch.
    expect(() => tasks.db.query({ scoped_invoices: {} })).toThrow();
    expect(() =>
      tasks.db.transact(
        tasks.db.tx.scoped_invoices["invoice_1"].update({ total: 10 }),
      ),
    ).toThrow();
  });
});

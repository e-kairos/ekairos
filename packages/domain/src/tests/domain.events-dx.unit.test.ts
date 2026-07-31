/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { i } from "@instantdb/core";
import { z } from "zod";
import { defineAction, defineEvent, domain } from "../index.ts";

function eventBase(name = "Sales Ops") {
  return domain(name).withSchema({
    entities: {
      context_events: i.entity({ type: i.string() }),
      sales_customers: i.entity({ name: i.string() }),
      sales_tags: i.entity({ name: i.string() }),
    }, links: {}, rooms: {},
  });
}

const customerChanged = defineEvent({
  payload: z.object({ customerId: z.string(), count: z.coerce.number() }),
  links: {
    customer: { on: "sales_customers", has: "one" },
    tags: { on: "sales_tags", has: "many" },
  },
});

describe("breaking domain event DX", () => {
  it("exposes frozen reflective metadata on the event constructor", () => {
    const sales = eventBase().withEvents({ customerChanged });
    const constructor = sales.events.customerChanged;

    expect(constructor.kind).toBe("Sales Ops.customerChanged");
    expect(constructor.domain).toBe("Sales Ops");
    expect(constructor.name).toBe("customerChanged");
    expect(constructor.payload).toBe(customerChanged.payload);
    expect(constructor.links).toEqual(customerChanged.links);
    expect(constructor.physicalLinks.customer).toMatchObject({
      key: "event__sales_ops__customer",
      target: "sales_customers",
      has: "one",
    });
    expect(Object.isFrozen(constructor)).toBe(true);
    expect(Object.isFrozen(constructor.definition)).toBe(true);
    expect(Object.isFrozen(constructor.links)).toBe(true);
    expect(Object.isFrozen(constructor.links.customer)).toBe(true);
    expect(Object.isFrozen(constructor.physicalLinks)).toBe(true);
    expect(Object.isFrozen(constructor.physicalLinks.customer)).toBe(true);
  });

  it("shares exact metadata with drafts without allowing link calls to mutate it", () => {
    const mutableLinks = {
      customer: { on: "sales_customers", has: "one" as const },
    };
    const declared = defineEvent({ payload: z.object({ id: z.string() }), links: mutableLinks });
    mutableLinks.customer.on = "sales_tags";

    const constructor = eventBase().withEvents({ declared }).events.declared;
    const draft = constructor({ id: "cus_1" });
    const linked = draft.link({ customer: "cus_1" });

    expect(constructor.links.customer.on).toBe("sales_customers");
    expect(draft.definition).toBe(constructor.definition);
    expect(linked.definition).toBe(constructor.definition);
    expect(constructor.links).toEqual({ customer: { on: "sales_customers", has: "one" } });
    expect(constructor.physicalLinks.customer.target).toBe("sales_customers");
    expect(Object.isFrozen(declared)).toBe(true);
    expect(Object.isFrozen(declared.links)).toBe(true);
    expect(Object.isFrozen(declared.links?.customer)).toBe(true);
  });

  it("constructs immutable parsed drafts and immutably merges one/many links", () => {
    const sales = eventBase().withEvents({ customerChanged });
    const initial = sales.events.customerChanged({ customerId: "cus_1", count: "2" });
    const withCustomer = initial.link({ customer: "lookup:customers:email:a@b.test" });
    const complete = withCustomer.link({ tags: ["tag_1", "tag_2"] });
    expect(initial.payload).toEqual({ customerId: "cus_1", count: 2 });
    expect(initial.links).toEqual({});
    expect(withCustomer.links).toEqual({ customer: "lookup:customers:email:a@b.test" });
    expect(complete.links).toEqual({ customer: "lookup:customers:email:a@b.test", tags: ["tag_1", "tag_2"] });
    expect(complete).toMatchObject({ domain: "Sales Ops", name: "customerChanged", kind: "Sales Ops.customerChanged" });
    expect(complete.physicalLinks.customer).toMatchObject({ key: "event__sales_ops__customer", target: "sales_customers", has: "one" });
    expect(Object.isFrozen(complete)).toBe(true);
    expect(Object.isFrozen(complete.payload)).toBe(true);
    expect(Object.isFrozen(complete.links)).toBe(true);
  });

  it("exposes generated real Instant links on the result and cached schema", () => {
    const sales = eventBase().withEvents({ customerChanged });
    const expected = {
      forward: { on: "context_events", has: "one", label: "sales_ops_customer" },
      reverse: { on: "sales_customers", has: "many", label: "sales_ops_events_as_customer" },
    };
    expect(sales.links.event__sales_ops__customer).toEqual(expected);
    expect(sales.instantSchema().links.event__sales_ops__customer).toEqual(expected);
    expect(sales.instantSchema()).toBe(sales.instantSchema());
    expect(sales.links.event__sales_ops__tags.forward.has).toBe("many");
  });

  it("rejects unknown aliases and invalid one/many values", () => {
    const draft = eventBase().withEvents({ customerChanged }).events.customerChanged({ customerId: "cus_1", count: 1 });
    expect(() => draft.link({ unknown: "x" } as any)).toThrow(/Unknown.*domain=Sales Ops.*event=customerChanged.*alias=unknown/);
    expect(() => draft.link({ customer: ["cus_1"] } as any)).toThrow(/Invalid.*alias=customer.*cardinality=one/);
    expect(() => draft.link({ tags: ["tag_1", 2] } as any)).toThrow(/Invalid.*alias=tags.*cardinality=many/);
  });

  it("surfaces payload Zod errors", () => {
    const sales = eventBase().withEvents({ customerChanged });
    expect(() => sales.events.customerChanged({ customerId: 4, count: 1 } as any)).toThrow(z.ZodError);
  });

  it("rejects invalid definitions, missing targets, and generated collisions with context", () => {
    expect(() => eventBase().withEvents({
      bad: defineEvent({ payload: z.object({}), links: { target: { on: "sales_customers", has: "invalid" as any } } }),
    })).toThrow(/domain=Sales Ops event=bad alias=target target=sales_customers cardinality=invalid/);
    const missing = eventBase().withEvents({
      missing: defineEvent({ payload: z.object({}), links: { order: { on: "sales_orders", has: "one" } } }),
    });
    expect(() => missing.instantSchema()).toThrow(/Missing.*domain=Sales Ops event=missing alias=order target=sales_orders cardinality=one/);
    const collision = domain("sales").withSchema({
      entities: { context_events: i.entity({ type: i.string() }), sales_customers: i.entity({ name: i.string() }) },
      links: { event__sales__customer: {
        forward: { on: "context_events", has: "one", label: "explicitCustomer" },
        reverse: { on: "sales_customers", has: "many", label: "explicitEvents" },
      } }, rooms: {},
    });
    expect(() => collision.withEvents({ customerChanged })).toThrow(/collision.*domain=sales.*alias=customer/);
  });

  it("allows identical aliases across events and rejects conflicting aliases", () => {
    const first = defineEvent({ payload: z.object({}), links: { customer: { on: "sales_customers", has: "one" } } });
    const same = defineEvent({ payload: z.object({}), links: { customer: { on: "sales_customers", has: "one" } } });
    const conflict = defineEvent({ payload: z.object({}), links: { customer: { on: "sales_tags", has: "many" } } });
    expect(() => eventBase("sales").withEvents({ first, same })).not.toThrow();
    expect(() => eventBase("sales").withEvents({ first, conflict })).toThrow(/Conflicting.*event=conflict.*alias=customer.*target=sales_tags.*cardinality=many/);
  });

  it("preserves chained withEvents/withActions ordering and prior drafts", () => {
    const first = eventBase("sales").withEvents({ customerChanged });
    const action = defineAction({ input: z.object({}), output: z.object({ ok: z.boolean() }), execute: () => ({ ok: true }) });
    const second = first.withActions({ ping: action }).withEvents({ tagged: defineEvent({ payload: z.object({ tag: z.string() }) }) });
    expect(Object.keys(first.events)).toEqual(["customerChanged"]);
    expect(Object.keys(second.events)).toEqual(["customerChanged", "tagged"]);
    expect(Object.keys(second.actions)).toEqual(["ping"]);
    expect(first.events).not.toBe(second.events);
  });

  it("creates a concrete capability scope with only selected events and actions", () => {
    const sales = eventBase("sales")
      .withEvents({
        customerChanged,
        tagged: defineEvent({ payload: z.object({ tag: z.string() }) }),
      })
      .withActions({
        publish: defineAction({
          input: z.object({ text: z.string() }),
          output: z.object({ ok: z.boolean() }),
          execute: () => ({ ok: true }),
        }),
        archive: defineAction({
          input: z.object({}),
          output: z.object({ ok: z.boolean() }),
          execute: () => ({ ok: true }),
        }),
      });

    const coaching = sales.scope({
      events: [sales.events.customerChanged],
      actions: [sales.actions.publish],
    });

    expect(Object.keys(coaching.events)).toEqual(["customerChanged"]);
    expect(Object.keys(coaching.actions)).toEqual(["publish"]);
    expect(coaching.instantSchema().links).toEqual(sales.instantSchema().links);
    expect(() => sales.scope({
      events: [eventBase("other").withEvents({ customerChanged }).events.customerChanged],
      actions: [sales.actions.publish],
    })).toThrow("domain_scope_event_outside_domain:other.customerChanged");
  });
});

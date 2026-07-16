import { i, type InstaQLParams } from "@instantdb/core";
import { z } from "zod";
import {
  defineEvent,
  domain,
  type DomainEventConstructor,
  type DomainInstantSchema,
} from "..";

const orders = domain("orders").withSchema({
  entities: {
    context_events: i.entity({ type: i.string() }),
    orders_orders: i.entity({ number: i.string() }),
    orders_lines: i.entity({ sku: i.string() }),
  }, links: {}, rooms: {},
}).withEvents({
  submitted: defineEvent({
    payload: z.object({ orderId: z.string() }),
    links: { order: { on: "orders_orders", has: "one" }, lines: { on: "orders_lines", has: "many" } },
  }),
});

const draft = orders.events.submitted({ orderId: "ord_1" }).link({ order: "ord_1" }).link({ lines: ["line_1", "line_2"] });
draft.link({ lines: "line_3" });
// @ts-expect-error one links accept one string, not arrays
draft.link({ order: ["ord_1"] });
// @ts-expect-error unknown aliases are rejected
draft.link({ customer: "cus_1" });
// @ts-expect-error payload is checked by the Zod output type
orders.events.submitted({ orderId: 1 });

type OrdersSchema = DomainInstantSchema<typeof orders>;
const generatedLinkQuery = {
  context_events: { orders_order: {} },
  orders_orders: { orders_events_as_order: {} },
  orders_lines: { orders_events_as_lines: {} },
} satisfies InstaQLParams<OrdersSchema>;
type _GeneratedLinkQuery = typeof generatedLinkQuery;

type ReactorTriggerInput<Constructor extends DomainEventConstructor<any, any, any, any, any>> = {
  payload: Parameters<Constructor>[0];
  parsedPayload: ReturnType<Constructor>["payload"];
  links: Parameters<ReturnType<Constructor>["link"]>[0];
};

const inferredTriggerInput = {
  payload: { orderId: "ord_2" },
  parsedPayload: { orderId: "ord_2" },
  links: { order: "ord_2", lines: ["line_3"] },
} satisfies ReactorTriggerInput<typeof orders.events.submitted>;

type _InferredTriggerInput = typeof inferredTriggerInput;

const reflectedKind: "orders.submitted" = orders.events.submitted.kind;
const reflectedDomain: "orders" = orders.events.submitted.domain;
const reflectedName: "submitted" = orders.events.submitted.name;
const reflectedPayloadSchema: typeof orders.events.submitted.payload = orders.events.submitted.definition.payload;
const reflectedLinks: typeof orders.events.submitted.links = orders.events.submitted.definition.links;
void reflectedKind;
void reflectedDomain;
void reflectedName;
void reflectedPayloadSchema;
void reflectedLinks;

const invalidInferredTriggerInput = {
  payload: { orderId: "ord_2" },
  parsedPayload: { orderId: "ord_2" },
  // @ts-expect-error inferred one-link params reject arrays
  links: { order: ["ord_2"] },
} satisfies ReactorTriggerInput<typeof orders.events.submitted>;
void invalidInferredTriggerInput;

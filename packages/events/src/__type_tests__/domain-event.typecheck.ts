import { i } from "@instantdb/core"
import { defineEvent, domain } from "@ekairos/domain"
import { z } from "zod"

import {
  Events,
  contextDomain,
  type ContextRuntimeServiceHandle,
} from "../index.js"

const orders = domain("orders").includes(contextDomain).withSchema({
  entities: {
    orders_orders: i.entity({ number: i.string() }),
  },
  links: {},
  rooms: {},
}).withEvents({
  submitted: defineEvent({
    payload: z.object({ orderNo: z.string() }),
    links: { order: { on: "orders_orders", has: "one" } },
  }),
})

declare const runtime: ContextRuntimeServiceHandle

const emitted = Events(runtime).emit(
  orders.events.submitted({ orderNo: "A-1" }).link({ order: "order-1" }),
  {
    id: "event-1",
    channel: "web",
    type: "input",
    status: "stored",
    createdAt: new Date(),
  },
)

type Emitted = Awaited<typeof emitted>
declare const event: Emitted
const orderNo: string = event.payload.orderNo
// @ts-expect-error payload remains typed after emission
event.payload.missing
void orderNo

import { defineEvent, domain } from "@ekairos/domain";
import { registryDomain } from "./domain/registry/schema";
import { contextDomain } from "@ekairos/events/schema";
import { z } from "zod";

const appDomain = domain("app")
  .includes(registryDomain)
  .includes(contextDomain)
  .withSchema({
    entities: {},
    links: {},
    rooms: {},
  })
  .withEvents({
    codexRequested: defineEvent({ payload: z.object({ prompt: z.string() }) }),
    codexCompleted: defineEvent({ payload: z.any() }),
  });

export default appDomain;

import { i } from "@instantdb/core";
import { z } from "zod";

import { defineDomainAction, domain, type DomainActionsOf } from "../index.ts";

const reflectedDomain = domain("typed-action-reflection")
  .withSchema({
    entities: {
      typed_action_tasks: i.entity({
        title: i.string(),
      }),
    },
    links: {},
    rooms: {},
  })
  .withActions({
    getSandbox: defineDomainAction({
      name: "typedActionReflection.getSandbox",
      input: z.object({ sandboxId: z.string() }),
      output: z.object({ id: z.string() }),
      execute: async ({ input }) => ({ id: input.sandboxId }),
    }),
  });

const reflectedActions: DomainActionsOf<typeof reflectedDomain> = reflectedDomain.actions;

reflectedActions.getSandbox.execute({
  input: { sandboxId: "sandbox_1" },
  runtime: {},
});

// @ts-expect-error action keys are the literal keys declared in withActions().
reflectedActions.missingSandbox;

reflectedActions.getSandbox.execute({
  // @ts-expect-error action inputs keep the declared shape.
  input: { wrong: "sandbox_1" },
  runtime: {},
});

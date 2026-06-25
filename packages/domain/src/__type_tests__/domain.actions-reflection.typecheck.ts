import { i } from "@instantdb/core";
import { z } from "zod";

import {
  defineDomainAction,
  domain,
  type DomainActionBelongsTo,
  type DomainActionOwner,
  type DomainActionsOf,
  type DomainRuntime,
} from "../index.ts";

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

type AssertTrue<T extends true> = T;
type AssertFalse<T extends false> = T;

type GetSandboxAction = typeof reflectedActions.getSandbox;
type GetSandboxOwner = DomainActionOwner<GetSandboxAction>;
type GetSandboxRuntime = DomainRuntime<GetSandboxOwner>;

const reflectedOwner: GetSandboxOwner = reflectedDomain;

const unrelatedDomain = domain("unrelated-action-owner")
  .withSchema({
    entities: {},
    links: {},
    rooms: {},
  });

// @ts-expect-error action owner is the domain that registered it.
const unrelatedOwner: GetSandboxOwner = unrelatedDomain;

type _actionBelongsToReflectedDomain = AssertTrue<
  DomainActionBelongsTo<GetSandboxAction, typeof reflectedDomain>
>;
type _actionDoesNotBelongToUnrelatedDomain = AssertFalse<
  DomainActionBelongsTo<GetSandboxAction, typeof unrelatedDomain>
>;

const scopedRuntime: GetSandboxRuntime = {
  domain: reflectedDomain,
  db: {
    query: async () => ({}),
    transact: async () => ({}),
    tx: {},
  },
  schema: reflectedDomain.instantSchema(),
  context: reflectedDomain.context,
  contextString: reflectedDomain.contextString,
  env: {},
  actions: {} as GetSandboxRuntime["actions"],
};

reflectedActions.getSandbox.execute({
  input: { sandboxId: "sandbox_1" },
  runtime: scopedRuntime,
});

const scopedGetSandbox = reflectedActions.getSandbox.scope({ sandboxId: "sandbox_1" });

scopedGetSandbox.execute({
  input: {},
  runtime: scopedRuntime,
});

scopedRuntime.actions.getSandbox = reflectedActions.getSandbox as GetSandboxRuntime["actions"]["getSandbox"];

const runtimeScopedGetSandbox = scopedRuntime.actions.getSandbox.scope({
  sandboxId: "sandbox_1",
});

runtimeScopedGetSandbox({});

// @ts-expect-error sandboxId was already bound by the scoped raw action.
scopedGetSandbox.execute({
  input: { sandboxId: "sandbox_1" },
  runtime: scopedRuntime,
});

// @ts-expect-error sandboxId was already bound by the scoped runtime method.
runtimeScopedGetSandbox({ sandboxId: "sandbox_1" });

reflectedActions.getSandbox.execute({
  input: { sandboxId: "sandbox_1" },
  // @ts-expect-error registered actions require a runtime scoped to their owner domain.
  runtime: {},
});

// @ts-expect-error action keys are the literal keys declared in withActions().
reflectedActions.missingSandbox;

reflectedActions.getSandbox.execute({
  // @ts-expect-error action inputs keep the declared shape.
  input: { wrong: "sandbox_1" },
  runtime: {},
});

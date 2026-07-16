import { i } from "@instantdb/core";
import { z } from "zod";

import {
  defineDomainAction,
  domain,
  EkairosRuntime,
  type DomainActionBelongsTo,
  type DomainActionOwner,
  type DomainActionsOf,
} from "../index";
import {
  executeDomainAction,
  prepareDomainActionExecution,
} from "../internal";

type AssertTrue<Value extends true> = Value;
type AssertFalse<Value extends false> = Value;

const getSandbox = defineDomainAction({
  input: z.object({ sandboxId: z.string(), detail: z.boolean() }),
  output: z.object({ id: z.string() }),
  execute: async ({ input }) => ({ id: input.sandboxId }),
});

// @ts-expect-error implementations are private even before registration.
getSandbox.execute;

const reflectedDomain = domain("typed-action-reflection")
  .withSchema({
    entities: {
      typed_action_tasks: i.entity({ title: i.string() }),
    },
    links: {},
    rooms: {},
  })
  .withActions({ getSandbox });

const rootDomain = domain("typed-action-root")
  .includes(reflectedDomain)
  .withSchema({ entities: {}, links: {}, rooms: {} })
  .withActions({ readSandbox: reflectedDomain.actions.getSandbox });

const reflectedActions: DomainActionsOf<typeof reflectedDomain> =
  reflectedDomain.actions;
const reexposed = rootDomain.actions.readSandbox;

const canonicalId: "typed-action-reflection.getSandbox" = reexposed.id;
const ownerDomain: "typed-action-reflection" = reexposed.ownerDomain;
const originalKey: "getSandbox" = reexposed.key;

// @ts-expect-error registered descriptors are not directly executable.
reexposed.execute;
// @ts-expect-error action keys are the literal membership keys.
rootDomain.actions.getSandbox;

type GetSandboxOwner = DomainActionOwner<typeof reexposed>;
const reflectedOwner: GetSandboxOwner = reflectedDomain;

const unrelatedDomain = domain("unrelated-action-owner")
  .withSchema({ entities: {}, links: {}, rooms: {} });

// @ts-expect-error re-exposure does not rebind the original owner.
const unrelatedOwner: GetSandboxOwner = unrelatedDomain;

type _actionBelongsToRoot = AssertTrue<
  DomainActionBelongsTo<typeof reexposed, typeof rootDomain>
>;
type _actionDoesNotBelongToUnrelated = AssertFalse<
  DomainActionBelongsTo<typeof reexposed, typeof unrelatedDomain>
>;

const scoped = reflectedActions.getSandbox.scope({
  sandboxId: "sandbox_1",
});
const scopedId: "typed-action-reflection.getSandbox" = scoped.id;
scoped.input.parse({ detail: true });

class ReflectionRuntime extends EkairosRuntime<
  { orgId: string },
  typeof rootDomain,
  { query: (query: unknown) => Promise<unknown> }
> {
  protected getDomain() {
    return rootDomain;
  }

  protected resolveDb() {
    return { query: async (query: unknown) => query };
  }
}

async function typecheckExecution() {
  const runtime = new ReflectionRuntime({ orgId: "org_1" });
  const active = await runtime.use(reflectedDomain);
  await active.actions.getSandbox({ sandboxId: "sandbox_1", detail: true });
  const preparation = await prepareDomainActionExecution(runtime, scoped, {
    detail: true,
  });
  const effectiveSandboxId: string = preparation.effectiveInput.sandboxId;
  await executeDomainAction(runtime, scoped, preparation);
  void effectiveSandboxId;

  // @ts-expect-error sandboxId was removed from the remaining scoped input.
  await executeDomainAction(runtime, scoped, {
    sandboxId: "sandbox_1",
    detail: true,
  });
}

void canonicalId;
void ownerDomain;
void originalKey;
void reflectedOwner;
void scopedId;
void typecheckExecution;

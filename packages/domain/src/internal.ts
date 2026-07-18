import type {
  DomainActionFullInput,
  DomainActionInput,
  DomainActionOutput,
  DomainActionRegistration,
  DomainActionRuntimeLike,
} from "./index.js";
import {
  executeDomainActionPrivate,
  getDomainActionBindingView,
  prepareDomainActionExecutionPrivate,
  registerDomainActionInputResolverPrivate,
  type DomainActionExecutionOptions,
  type DomainActionInputResolver,
} from "./domain-action.internal.js";

export type {
  DomainActionInputResolver,
  DomainActionInputResolverContext,
} from "./domain-action.internal.js";

declare const PREPARED_DOMAIN_ACTION_TYPE: unique symbol;

export type DomainActionBinding = Readonly<{
  id: string;
  ownerDomain: string;
  key: string;
  ownerDomainObject: object;
  boundInput: Readonly<Record<string, unknown>>;
}>;

export type ExecuteDomainActionResult<
  Action extends DomainActionRegistration<any, any, any, any>,
> = Readonly<{
  output: DomainActionOutput<Action>;
  effectiveInput: DomainActionFullInput<Action>;
}>;

export type PreparedDomainActionExecution<
  Action extends DomainActionRegistration<any, any, any, any>,
> = Readonly<{
  id: Action["id"];
  ownerDomain: Action["ownerDomain"];
  key: Action["key"];
  effectiveInput: DomainActionFullInput<Action>;
  readonly [PREPARED_DOMAIN_ACTION_TYPE]?: Action;
}>;

export function getDomainActionBinding(
  registration: DomainActionRegistration<any, any, any, any>,
): DomainActionBinding | null {
  return getDomainActionBindingView(registration);
}

export function registerDomainActionInputResolver(
  schema: object,
  resolver: DomainActionInputResolver,
): void {
  registerDomainActionInputResolverPrivate(schema, resolver);
}

export async function prepareDomainActionExecution<
  Action extends DomainActionRegistration<any, any, any, any>,
>(
  runtime: DomainActionRuntimeLike,
  registration: Action,
  remainingInput: DomainActionInput<Action>,
): Promise<PreparedDomainActionExecution<Action>> {
  return await prepareDomainActionExecutionPrivate(
    runtime,
    registration,
    remainingInput,
  ) as PreparedDomainActionExecution<Action>;
}

export async function executeDomainAction<
  Action extends DomainActionRegistration<any, any, any, any>,
>(
  runtime: DomainActionRuntimeLike,
  registration: Action,
  remainingInputOrPreparation:
    | DomainActionInput<Action>
    | PreparedDomainActionExecution<Action>,
  options: DomainActionExecutionOptions = {},
): Promise<ExecuteDomainActionResult<Action>> {
  return await executeDomainActionPrivate(
    runtime,
    registration,
    remainingInputOrPreparation,
    options,
  ) as ExecuteDomainActionResult<Action>;
}

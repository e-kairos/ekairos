import { z } from "zod";

type ActionSchema = z.ZodType;

type ActionImplementation = (params: {
  input: unknown;
  runtime: unknown;
  domain: unknown;
  reactionId?: string;
}) => unknown;

type ActionDescriptor = Readonly<{
  description?: string;
  input: ActionSchema;
  output: ActionSchema;
  inputSchema?: unknown;
  outputSchema?: unknown;
  requiredScopes?: readonly string[];
}>;

type DefinitionState = Readonly<{
  implementation: ActionImplementation;
  fullInputSchema: ActionSchema;
  outputSchema: ActionSchema;
}>;

type RegistrationState = DefinitionState & Readonly<{
  id: string;
  ownerDomain: string;
  key: string;
  ownerDomainObject: object;
  remainingInputSchema: ActionSchema;
  rawBoundInput: Readonly<Record<string, unknown>>;
  boundInput: Readonly<Record<string, unknown>>;
  bindingView: DomainActionBindingView;
}>;

export type DomainActionBindingView = Readonly<{
  id: string;
  ownerDomain: string;
  key: string;
  ownerDomainObject: object;
  boundInput: Readonly<Record<string, unknown>>;
}>;

export type DomainActionExecutionResult = Readonly<{
  output: unknown;
  effectiveInput: unknown;
}>;

export type DomainActionExecutionPreparationView = Readonly<{
  id: string;
  ownerDomain: string;
  key: string;
  effectiveInput: unknown;
}>;

export type DomainActionExecutionOptions = Readonly<{
  activeDomain?: unknown;
  stack?: readonly string[];
  reactionId?: string;
}>;

export type DomainActionInputResolverContext = Readonly<{
  actionId: string;
  ownerDomain: string;
  key: string;
  path: string;
  runtime: object;
  value: unknown;
}>;

export type DomainActionInputResolver = (
  context: DomainActionInputResolverContext,
) => void | Promise<void>;

type ExecutionPreparationState = Readonly<{
  action: RegistrationState;
  registration: object;
  runtime: object;
  executionDomain: unknown;
  effectiveInput: unknown;
}>;

type DomainActionRealmState = Readonly<{
  definitions: WeakMap<object, DefinitionState>;
  registrations: WeakMap<object, RegistrationState>;
  domainMemberships: WeakMap<object, readonly object[]>;
  activeDomainScopeFactories: WeakMap<
    object,
    (stack: readonly string[]) => unknown
  >;
  runtimeRootDomains: WeakMap<object, object>;
  actionInputResolvers: WeakMap<object, DomainActionInputResolver>;
  executionPreparations: WeakMap<object, ExecutionPreparationState>;
}>;

const DOMAIN_ACTION_REALM_STATE = Symbol.for(
  "@ekairos/domain/action-realm-state/v1",
);

function domainActionRealmState(): DomainActionRealmState {
  const realm = globalThis as Record<PropertyKey, unknown>;
  const existing = realm[DOMAIN_ACTION_REALM_STATE];
  if (existing) return existing as DomainActionRealmState;

  const created = Object.freeze({
    definitions: new WeakMap<object, DefinitionState>(),
    registrations: new WeakMap<object, RegistrationState>(),
    domainMemberships: new WeakMap<object, readonly object[]>(),
    activeDomainScopeFactories: new WeakMap<
      object,
      (stack: readonly string[]) => unknown
    >(),
    runtimeRootDomains: new WeakMap<object, object>(),
    actionInputResolvers: new WeakMap<object, DomainActionInputResolver>(),
    executionPreparations: new WeakMap<object, ExecutionPreparationState>(),
  });
  Object.defineProperty(realm, DOMAIN_ACTION_REALM_STATE, {
    value: created,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return created;
}

const {
  definitions,
  registrations,
  domainMemberships,
  activeDomainScopeFactories,
  runtimeRootDomains,
  actionInputResolvers,
  executionPreparations,
} = domainActionRealmState();

function actionInputResolverKey(schema: object): object {
  const definition = (schema as any)._zod?.def;
  return isObjectLike(definition) ? definition : schema;
}

export function registerDomainActionInputResolverPrivate(
  schema: unknown,
  resolver: DomainActionInputResolver,
): void {
  if (!isObjectLike(schema) || typeof (schema as any).parse !== "function") {
    throw new Error("domain_action_input_resolver_schema_required");
  }
  if (typeof resolver !== "function") {
    throw new Error("domain_action_input_resolver_required");
  }
  actionInputResolvers.set(actionInputResolverKey(schema), resolver);
}

function isObjectLike(value: unknown): value is object {
  return !!value && (typeof value === "object" || typeof value === "function");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze<Value>(value: Value): Value {
  if (!isObjectLike(value) || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function toJsonSchema(schema: ActionSchema): unknown {
  try {
    return deepFreeze(z.toJSONSchema(schema as never, { target: "draft-7" }));
  } catch {
    return undefined;
  }
}

function descriptorMetadata(source: ActionDescriptor) {
  const requiredScopes = source.requiredScopes
    ? Object.freeze([...source.requiredScopes])
    : undefined;
  return {
    ...(typeof source.description === "string"
      ? { description: source.description }
      : {}),
    ...(requiredScopes ? { requiredScopes } : {}),
  };
}

function requireDefinitionState(source: unknown): DefinitionState {
  if (!isObjectLike(source)) {
    throw new Error("domain_action_definition_required");
  }
  const state = definitions.get(source) ?? registrations.get(source);
  if (!state) throw new Error("domain_action_definition_required");
  return state;
}

function requireRegistrationState(source: unknown): RegistrationState {
  if (!isObjectLike(source)) {
    throw new Error("domain_action_registration_required");
  }
  const state = registrations.get(source);
  if (!state) throw new Error("domain_action_registration_required");
  return state;
}

function requireZodObject(
  schema: ActionSchema,
  actionId: string,
): z.ZodObject<any> {
  if (schema instanceof z.ZodObject) return schema;
  throw new Error(`domain_action_scope_requires_object_input:${actionId}`);
}

function zodObjectShape(schema: z.ZodObject<any>): Record<string, unknown> {
  const shape = (schema as any).shape;
  if (shape && typeof shape === "object") return shape;
  const definitionShape = (schema as any)._def?.shape;
  if (typeof definitionShape === "function") return definitionShape();
  if (definitionShape && typeof definitionShape === "object") {
    return definitionShape;
  }
  return {};
}

function createRegistration(
  source: ActionDescriptor,
  state: Omit<RegistrationState, "bindingView">,
): object {
  const boundInput = deepFreeze({ ...state.boundInput });
  const bindingView = Object.freeze({
    id: state.id,
    ownerDomain: state.ownerDomain,
    key: state.key,
    ownerDomainObject: state.ownerDomainObject,
    boundInput,
  });

  let registration: object;
  const scope = (boundInputValue: Record<string, unknown>) =>
    scopeDomainActionRegistration(registration, boundInputValue);
  registration = Object.freeze({
    id: state.id,
    ownerDomain: state.ownerDomain,
    key: state.key,
    ...descriptorMetadata(source),
    input: state.remainingInputSchema,
    output: state.outputSchema,
    inputSchema: toJsonSchema(state.remainingInputSchema),
    outputSchema: source.outputSchema ?? toJsonSchema(state.outputSchema),
    scope,
  });

  registrations.set(registration, Object.freeze({
    ...state,
    boundInput,
    bindingView,
  }));
  return registration;
}

export function createDomainActionDefinition(params: {
  description?: string;
  input: ActionSchema;
  output: ActionSchema;
  requiredScopes?: readonly string[];
  execute: ActionImplementation;
}): object {
  if (!params?.input || typeof params.input.parse !== "function") {
    throw new Error("domain_action_input_schema_required");
  }
  if (!params.output || typeof params.output.parse !== "function") {
    throw new Error("domain_action_output_schema_required");
  }
  if (typeof params.execute !== "function") {
    throw new Error("domain_action_implementation_required");
  }

  const descriptor = Object.freeze({
    ...descriptorMetadata(params),
    input: params.input,
    output: params.output,
    inputSchema: toJsonSchema(params.input),
    outputSchema: toJsonSchema(params.output),
  });
  definitions.set(descriptor, Object.freeze({
    implementation: params.execute,
    fullInputSchema: params.input,
    outputSchema: params.output,
  }));
  return descriptor;
}

export function isDomainActionDefinition(source: unknown): boolean {
  return isObjectLike(source) && definitions.has(source);
}

export function isDomainActionRegistration(source: unknown): boolean {
  return isObjectLike(source) && registrations.has(source);
}

export function registerDomainAction(
  source: ActionDescriptor,
  params: {
    ownerDomain: string;
    key: string;
    ownerDomainObject: object;
  },
): object {
  const definition = requireDefinitionState(source);
  const ownerDomain = String(params.ownerDomain ?? "").trim();
  const key = String(params.key ?? "").trim();
  if (!ownerDomain) throw new Error("domain_action_owner_required");
  if (!key) throw new Error("domain_action_key_required");
  if (!isObjectLike(params.ownerDomainObject)) {
    throw new Error(`domain_action_owner_object_required:${ownerDomain}.${key}`);
  }

  return createRegistration(source, {
    ...definition,
    id: `${ownerDomain}.${key}`,
    ownerDomain,
    key,
    ownerDomainObject: params.ownerDomainObject,
    remainingInputSchema: source.input,
    rawBoundInput: Object.freeze({}),
    boundInput: Object.freeze({}),
  });
}

export function rebindDomainActionOwner(
  source: ActionDescriptor,
  ownerDomainObject: object,
): object {
  const state = requireRegistrationState(source);
  if (!isObjectLike(ownerDomainObject)) {
    throw new Error(`domain_action_owner_object_required:${state.id}`);
  }
  return createRegistration(source, {
    ...state,
    ownerDomainObject,
  });
}

export function scopeDomainActionRegistration(
  source: object,
  boundInputValue: unknown,
): object {
  const state = requireRegistrationState(source);
  if (!isRecord(boundInputValue)) {
    throw new Error(`domain_action_scope_invalid_input:${state.id}`);
  }

  const inputObject = requireZodObject(state.remainingInputSchema, state.id);
  const shape = zodObjectShape(inputObject);
  const keys = Object.keys(boundInputValue);
  for (const key of keys) {
    if (!(key in shape)) {
      throw new Error(`domain_action_scope_unknown_input:${state.id}.${key}`);
    }
  }

  const mask = Object.fromEntries(keys.map((key) => [key, true]));
  const parsedBound = keys.length > 0
    ? inputObject.pick(mask as any).parse(boundInputValue)
    : {};
  const remainingInputSchema = keys.length > 0
    ? inputObject.omit(mask as any)
    : inputObject;

  return createRegistration(source as ActionDescriptor, {
    ...state,
    remainingInputSchema,
    rawBoundInput: Object.freeze({
      ...state.rawBoundInput,
      ...boundInputValue,
    }),
    boundInput: Object.freeze({
      ...state.boundInput,
      ...parsedBound,
    }),
  });
}

export function getDomainActionBindingView(
  source: unknown,
): DomainActionBindingView | null {
  if (!isObjectLike(source)) return null;
  return registrations.get(source)?.bindingView ?? null;
}

export function setDomainActionMembership(
  domain: object,
  actions: readonly object[],
): void {
  domainMemberships.set(domain, Object.freeze([...actions]));
}

export function getDomainActionMembership(domain: unknown): readonly object[] {
  if (!isObjectLike(domain)) return Object.freeze([]);
  return domainMemberships.get(domain) ?? Object.freeze([]);
}

export function setActiveDomainActionScopeFactory(
  activeDomain: object,
  factory: (stack: readonly string[]) => unknown,
): void {
  activeDomainScopeFactories.set(activeDomain, factory);
}

export function setRuntimeRootDomain(runtime: object, rootDomain: object): void {
  runtimeRootDomains.set(runtime, rootDomain);
}

function resolveRuntimeRootDomain(runtime: object): object | null {
  const stored = runtimeRootDomains.get(runtime);
  if (stored) return stored;
  const meta = (runtime as any).meta;
  if (typeof meta !== "function") return null;
  const value = meta.call(runtime)?.domain;
  return isObjectLike(value) ? value : null;
}

function sameCanonicalAction(left: RegistrationState, right: RegistrationState) {
  return (
    left.id === right.id &&
    left.ownerDomain === right.ownerDomain &&
    left.key === right.key
  );
}

function assertRuntimeMembership(runtime: object, action: RegistrationState) {
  const rootDomain = resolveRuntimeRootDomain(runtime);
  if (!rootDomain) {
    throw new Error(`domain_action_runtime_root_required:${action.id}`);
  }
  const member = getDomainActionMembership(rootDomain).some((candidate) => {
    const candidateState = registrations.get(candidate);
    return !!candidateState && sameCanonicalAction(candidateState, action);
  });
  if (!member) throw new Error(`domain_action_outside_runtime:${action.id}`);
}

function isOwnerActiveDomain(activeDomain: unknown, ownerDomainObject: object) {
  return (
    isObjectLike(activeDomain) &&
    (activeDomain as any).domain === ownerDomainObject
  );
}

function appendActionInputPath(path: string, segment: string | number): string {
  if (typeof segment === "number") return `${path}[${segment}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)
    ? `${path}.${segment}`
    : `${path}[${JSON.stringify(segment)}]`;
}

async function resolveActionInput(
  schema: ActionSchema,
  value: unknown,
  context: Omit<DomainActionInputResolverContext, "path" | "value">,
  path = "$",
): Promise<void> {
  if (value === undefined || value === null) return;

  const resolver = actionInputResolvers.get(actionInputResolverKey(schema));
  if (resolver) {
    await resolver({ ...context, path, value });
    return;
  }

  const definition = (schema as any)._zod?.def;
  if (!definition || typeof definition !== "object") return;

  switch (definition.type) {
    case "object": {
      if (!isRecord(value)) return;
      const shape = typeof definition.shape === "function"
        ? definition.shape()
        : definition.shape;
      if (!shape || typeof shape !== "object") return;
      for (const [key, childSchema] of Object.entries(shape)) {
        if (!isObjectLike(childSchema)) continue;
        await resolveActionInput(
          childSchema as ActionSchema,
          value[key],
          context,
          appendActionInputPath(path, key),
        );
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value) || !isObjectLike(definition.element)) return;
      for (let index = 0; index < value.length; index += 1) {
        await resolveActionInput(
          definition.element,
          value[index],
          context,
          appendActionInputPath(path, index),
        );
      }
      return;
    }
    case "tuple": {
      if (!Array.isArray(value)) return;
      const items = Array.isArray(definition.items) ? definition.items : [];
      for (let index = 0; index < value.length; index += 1) {
        const childSchema = items[index] ?? definition.rest;
        if (!isObjectLike(childSchema)) continue;
        await resolveActionInput(
          childSchema as ActionSchema,
          value[index],
          context,
          appendActionInputPath(path, index),
        );
      }
      return;
    }
    case "record": {
      if (!isRecord(value) || !isObjectLike(definition.valueType)) return;
      for (const [key, childValue] of Object.entries(value)) {
        await resolveActionInput(
          definition.valueType,
          childValue,
          context,
          appendActionInputPath(path, key),
        );
      }
      return;
    }
    case "union": {
      const options = Array.isArray(definition.options) ? definition.options : [];
      const matching = options.find(
        (option: any) => option?.safeParse?.(value)?.success === true,
      );
      if (isObjectLike(matching)) {
        await resolveActionInput(matching as ActionSchema, value, context, path);
      }
      return;
    }
    case "intersection": {
      if (isObjectLike(definition.left)) {
        await resolveActionInput(definition.left, value, context, path);
      }
      if (isObjectLike(definition.right)) {
        await resolveActionInput(definition.right, value, context, path);
      }
      return;
    }
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "nonoptional":
    case "readonly": {
      if (isObjectLike(definition.innerType)) {
        await resolveActionInput(definition.innerType, value, context, path);
      }
      return;
    }
    case "lazy": {
      const childSchema = typeof definition.getter === "function"
        ? definition.getter()
        : undefined;
      if (isObjectLike(childSchema)) {
        await resolveActionInput(childSchema as ActionSchema, value, context, path);
      }
      return;
    }
    case "pipe": {
      if (isObjectLike(definition.in)) {
        await resolveActionInput(definition.in, value, context, path);
      }
      return;
    }
  }
}

export async function prepareDomainActionExecutionPrivate(
  runtime: unknown,
  registration: unknown,
  remainingInput: unknown,
  options: DomainActionExecutionOptions = {},
): Promise<DomainActionExecutionPreparationView> {
  if (!isObjectLike(registration)) {
    throw new Error("domain_action_registration_required");
  }
  const action = requireRegistrationState(registration);
  if (!isObjectLike(runtime) || typeof (runtime as any).use !== "function") {
    throw new Error(`domain_action_runtime_required:${action.id}`);
  }
  assertRuntimeMembership(runtime, action);

  const stack = [...(options.stack ?? [])];
  if (stack.includes(action.id)) {
    throw new Error(`domain_action_cycle:${action.id}`);
  }
  const nextStack = Object.freeze([...stack, action.id]);

  const effectiveInput = deepFreeze(
    Object.keys(action.rawBoundInput).length > 0
      ? action.fullInputSchema.parse({
          ...(isRecord(remainingInput) ? remainingInput : {}),
          ...action.rawBoundInput,
        })
      : action.fullInputSchema.parse(remainingInput),
  );

  const activeDomain = isOwnerActiveDomain(
    options.activeDomain,
    action.ownerDomainObject,
  )
    ? options.activeDomain
    : await (runtime as any).use(action.ownerDomainObject);
  if (!isOwnerActiveDomain(activeDomain, action.ownerDomainObject)) {
    throw new Error(`domain_action_owner_scope_mismatch:${action.id}`);
  }

  await resolveActionInput(action.fullInputSchema, effectiveInput, {
    actionId: action.id,
    ownerDomain: action.ownerDomain,
    key: action.key,
    runtime,
  });

  const scopeFactory = activeDomainScopeFactories.get(activeDomain as object);
  const executionDomain = scopeFactory
    ? scopeFactory(nextStack)
    : activeDomain;
  const preparation = Object.freeze({
    id: action.id,
    ownerDomain: action.ownerDomain,
    key: action.key,
    effectiveInput,
  });
  executionPreparations.set(
    preparation,
    Object.freeze({
      action,
      registration,
      runtime,
      executionDomain,
      effectiveInput,
    }),
  );
  return preparation;
}

export async function executeDomainActionPrivate(
  runtime: unknown,
  registration: unknown,
  remainingInputOrPreparation: unknown,
  options: DomainActionExecutionOptions = {},
): Promise<DomainActionExecutionResult> {
  const preparationState = isObjectLike(remainingInputOrPreparation)
    ? executionPreparations.get(remainingInputOrPreparation)
    : undefined;
  const preparation = preparationState
    ? remainingInputOrPreparation
    : await prepareDomainActionExecutionPrivate(
        runtime,
        registration,
        remainingInputOrPreparation,
        options,
      );
  const prepared = preparationState ??
    executionPreparations.get(preparation as object);
  if (!prepared) throw new Error("domain_action_preparation_required");
  if (prepared.runtime !== runtime) {
    throw new Error(
      `domain_action_preparation_runtime_mismatch:${prepared.action.id}`,
    );
  }
  if (prepared.registration !== registration) {
    throw new Error(
      `domain_action_preparation_registration_mismatch:${prepared.action.id}`,
    );
  }

  const rawOutput = await prepared.action.implementation({
    input: prepared.effectiveInput,
    runtime,
    domain: prepared.executionDomain,
    ...(options.reactionId ? { reactionId: options.reactionId } : {}),
  });
  const output = prepared.action.outputSchema.parse(rawOutput);
  return Object.freeze({ output, effectiveInput: prepared.effectiveInput });
}
